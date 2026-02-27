import { setTimeout as sleep } from 'node:timers/promises';
import type { Server } from 'node:http';
import { startApiServer } from './server.ts';
import { closeQueueRuntime } from './orchestration/queue-runtime.ts';
import { closePgPool } from './persistence/pg-pool.ts';

type JsonObject = Record<string, unknown>;

type ApiCallOptions = {
  method?: 'GET' | 'POST';
  token?: string;
  body?: JsonObject;
};

const requiredEnv = (name: string) => {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`ENV_MISSING:${name}`);
  return value;
};

const closeServer = async (server: Server) => {
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };

    server.close(() => finish());
    setTimeout(() => finish(), 4_000).unref();
  });
};

const withCleanupTimeout = async (label: string, promise: Promise<unknown>, timeoutMs = 8_000) => {
  let timedOut = false;
  await Promise.race([
    promise.catch((error) => {
      console.warn(JSON.stringify({ event: 'cleanup_error', label, detail: String((error as Error)?.message ?? error) }));
    }),
    sleep(timeoutMs).then(() => {
      timedOut = true;
    })
  ]);

  if (timedOut) {
    console.warn(JSON.stringify({ event: 'cleanup_timeout', label, timeoutMs }));
  }
};

const cleanupResources = async (server: Server) => {
  await withCleanupTimeout('http_server_close', closeServer(server));
  await withCleanupTimeout('queue_runtime_close', closeQueueRuntime());
  await withCleanupTimeout('pg_pool_close', closePgPool());
};

const parseJson = async (res: Response) => {
  const raw = await res.text();
  if (!raw) return {} as JsonObject;
  try {
    return JSON.parse(raw) as JsonObject;
  } catch {
    return { raw } as JsonObject;
  }
};

const requestApi = async (base: string, path: string, options?: ApiCallOptions) => {
  const res = await fetch(`${base}${path}`, {
    method: options?.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(options?.token ? { authorization: `Bearer ${options.token}` } : {})
    },
    body: options?.body ? JSON.stringify(options.body) : undefined
  });

  const body = await parseJson(res);
  return { status: res.status, body };
};

const supabaseRequest = async (path: string, init: RequestInit, useServiceRole = false) => {
  const base = requiredEnv('SUPABASE_URL');
  const anonKey = requiredEnv('SUPABASE_ANON_KEY');
  const serviceKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const key = useServiceRole ? serviceKey : anonKey;

  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(init.headers ?? {})
    }
  });

  const body = await parseJson(res);
  return { status: res.status, body };
};

const listAdminUsers = async () => {
  const res = await supabaseRequest('/auth/v1/admin/users?page=1&per_page=200', { method: 'GET' }, true);
  const users = Array.isArray(res.body.users) ? (res.body.users as JsonObject[]) : [];
  return { status: res.status, users };
};

const findUserIdByEmail = async (email: string) => {
  const listed = await listAdminUsers();
  if (listed.status < 200 || listed.status >= 300) return '';
  const found = listed.users.find((user) => String(user.email ?? '').toLowerCase() === email.toLowerCase());
  return String(found?.id ?? '');
};

const createAdminUser = async (email: string, password: string) => {
  const created = await supabaseRequest(
    '/auth/v1/admin/users',
    {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { smoke: true, plan: 'free' }
      })
    },
    true
  );

  if (![200, 201, 422].includes(created.status)) {
    throw new Error(`AUTH_ADMIN_CREATE_FAILED:${created.status}:${String(created.body?.msg ?? created.body?.error ?? '')}`);
  }

  const directUserId = String((created.body.user as JsonObject | undefined)?.id ?? '');
  if (directUserId) {
    return { status: created.status, userId: directUserId };
  }

  return {
    status: created.status,
    userId: await findUserIdByEmail(email)
  };
};

const ensureEmailConfirmed = async (userId: string) => {
  const payload = {
    email_confirm: true,
    user_metadata: {
      smoke: true,
      plan: 'free'
    }
  };

  const putRes = await supabaseRequest(
    `/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload)
    },
    true
  );

  if (putRes.status >= 200 && putRes.status < 300) {
    return { ok: true, status: putRes.status, via: 'PUT' as const };
  }

  const patchRes = await supabaseRequest(
    `/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload)
    },
    true
  );

  if (patchRes.status >= 200 && patchRes.status < 300) {
    return { ok: true, status: patchRes.status, via: 'PATCH' as const };
  }

  const detail = String(
    putRes.body?.msg ?? putRes.body?.error_description ?? putRes.body?.error ?? patchRes.body?.msg ?? patchRes.body?.error ?? ''
  );
  throw new Error(`AUTH_EMAIL_CONFIRM_FAILED:${putRes.status}/${patchRes.status}:${detail}`);
};

const deleteUser = async (userId: string) => {
  if (!userId) return;
  await supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' }, true);
};

const waitForReady = async (base: string, token: string, jobId: string) => {
  const videoStageTimeoutMs = Math.max(300_000, Number(process.env.VIDEO_STAGE_TIMEOUT_MS ?? 1_800_000));
  const timeoutMs = Math.max(videoStageTimeoutMs + 120_000, Number(process.env.E2E_JOB_TIMEOUT_MS ?? 1_920_000));
  const pollSleepMs = Math.max(2_000, Number(process.env.FREE_FLOW_POLL_MS ?? 4_000));
  const maxTransientAuthErrors = Math.max(3, Number(process.env.FREE_FLOW_MAX_TRANSIENT_AUTH_ERRORS ?? 10));
  const started = Date.now();
  let poll = 0;
  let transientAuthErrors = 0;

  while (Date.now() - started < timeoutMs) {
    poll += 1;
    const jobRes = await requestApi(base, `/v1/jobs/${jobId}`, {
      method: 'GET',
      token
    });

    if (jobRes.status !== 200) {
      const error = String(jobRes.body.error ?? 'UNKNOWN_ERROR');
      console.log(JSON.stringify({ poll, httpStatus: jobRes.status, error }));

      if (error.startsWith('AUTH_PROVIDER_')) {
        transientAuthErrors += 1;
        if (transientAuthErrors <= maxTransientAuthErrors) {
          await sleep(pollSleepMs);
          continue;
        }
      }

      throw new Error(`JOB_STATUS_FETCH_FAILED:${jobRes.status}:${error}`);
    }

    transientAuthErrors = 0;

    const status = String(jobRes.body.status ?? 'unknown');
    const timelineLength = Array.isArray(jobRes.body.timeline) ? jobRes.body.timeline.length : 0;
    console.log(JSON.stringify({ poll, status, timelineLength }));

    if (status === 'READY' || status === 'FAILED') {
      return { status, body: jobRes.body };
    }

    await sleep(pollSleepMs);
  }

  throw new Error(`JOB_TIMEOUT:${jobId}`);
};

const run = async () => {
  const prevAuthRequired = process.env.AUTH_REQUIRED;
  const prevAutoPublish = process.env.ENABLE_AUTO_PUBLISH;
  const prevFreePlan = process.env.ENABLE_FREE_PLAN_MVP;

  process.env.AUTH_REQUIRED = 'true';
  process.env.ENABLE_AUTO_PUBLISH = 'false';
  process.env.ENABLE_FREE_PLAN_MVP = 'true';

  const { server, port } = await startApiServer(0);
  const base = `http://127.0.0.1:${port}`;

  const emailDomain = process.env.AUTH_SMOKE_EMAIL_DOMAIN?.trim() || 'googlemail.com';
  const email = `faceless-free-flow-${Date.now()}@${emailDomain}`;
  const password = `FreeFlow_${Date.now()}_A!`;

  let createdUserId = '';
  let exitCode = 1;

  try {
    const publicSignupMode = (process.env.FREE_FLOW_PUBLIC_SIGNUP ?? 'false').trim().toLowerCase() === 'true';

    let signupStatus = 0;
    let signupMode: 'public_signup' | 'admin_bootstrap' | 'admin_fallback_rate_limited' = publicSignupMode
      ? 'public_signup'
      : 'admin_bootstrap';
    let signupError = '';

    let requiresEmailConfirmation = false;
    let confirmStatus = 0;
    let confirmVia = 'none';

    if (publicSignupMode) {
      const signup = await requestApi(base, '/v1/auth/signup', {
        method: 'POST',
        body: { email, password }
      });

      signupStatus = signup.status;

      if (signup.status === 200) {
        createdUserId = String((signup.body.user as JsonObject | undefined)?.id ?? signup.body.id ?? '');
        if (!createdUserId) {
          throw new Error('AUTH_SIGNUP_USER_ID_MISSING');
        }

        requiresEmailConfirmation = Boolean(signup.body.requiresEmailConfirmation);

        if (requiresEmailConfirmation) {
          const confirmed = await ensureEmailConfirmed(createdUserId);
          confirmStatus = confirmed.status;
          confirmVia = confirmed.via;
          await sleep(400);
        }
      } else {
        signupError = String(signup.body.error ?? '');
        const rateLimited = signup.status === 429 || signupError.includes('AUTH_PROVIDER_429');
        if (!rateLimited) {
          throw new Error(`AUTH_SIGNUP_FAILED:${signup.status}:${signupError}`);
        }

        signupMode = 'admin_fallback_rate_limited';
        const created = await createAdminUser(email, password);
        createdUserId = created.userId;
        if (!createdUserId) {
          throw new Error('AUTH_ADMIN_FALLBACK_USER_ID_MISSING');
        }
        confirmStatus = created.status;
        confirmVia = 'ADMIN_CREATE';
        requiresEmailConfirmation = false;
      }
    } else {
      const created = await createAdminUser(email, password);
      createdUserId = created.userId;
      if (!createdUserId) {
        throw new Error('AUTH_ADMIN_BOOTSTRAP_USER_ID_MISSING');
      }
      signupStatus = created.status;
      confirmStatus = created.status;
      confirmVia = 'ADMIN_CREATE';
      requiresEmailConfirmation = false;
    }

    const login = await requestApi(base, '/v1/auth/login', {
      method: 'POST',
      body: { email, password }
    });

    if (login.status !== 200) {
      throw new Error(`AUTH_LOGIN_FAILED:${login.status}:${String(login.body.error ?? '')}`);
    }

    const accessToken = String(login.body.accessToken ?? '');
    if (!accessToken) {
      throw new Error('AUTH_LOGIN_TOKEN_MISSING');
    }

    const me = await requestApi(base, '/v1/auth/me', {
      method: 'GET',
      token: accessToken
    });

    if (me.status !== 200) {
      throw new Error(`AUTH_ME_FAILED:${me.status}`);
    }

    const canRunJob = Boolean(me.body.canRunJob);
    if (!canRunJob) {
      throw new Error(`AUTH_NOT_ENTITLED:${String(me.body.reason ?? 'unknown')}`);
    }

    const createProject = await requestApi(base, '/v1/projects', {
      method: 'POST',
      token: accessToken,
      body: {
        organizationId: 'org_free_customer_smoke',
        topic: 'Frühlingsangebot für lokale Bäckerei in Berlin',
        language: 'de',
        voice: 'de_female_01',
        variantType: 'SHORT_15'
      }
    });

    if (createProject.status !== 201) {
      throw new Error(`PROJECT_CREATE_FAILED:${createProject.status}:${String(createProject.body.error ?? '')}`);
    }

    const projectId = String(createProject.body.projectId ?? '');
    if (!projectId) {
      throw new Error('PROJECT_ID_MISSING');
    }

    const select = await requestApi(base, `/v1/projects/${projectId}/select`, {
      method: 'POST',
      token: accessToken,
      body: {
        conceptId: 'concept_web_vertical_slice', moodPreset: 'commercial_cta', approvedScript: 'Kurzes, klares Skript mit Abschlusssatz und CTA.', variantType: 'SHORT_15'
      }
    });

    if (select.status !== 200) {
      throw new Error(`PROJECT_SELECT_FAILED:${select.status}:${String(select.body.error ?? '')}`);
    }

    const jobId = String(select.body.jobId ?? '');
    if (!jobId) {
      throw new Error('JOB_ID_MISSING');
    }

    const generate = await requestApi(base, `/v1/projects/${projectId}/generate`, {
      method: 'POST',
      token: accessToken,
      body: { jobId }
    });

    if (generate.status !== 200) {
      throw new Error(`GENERATE_FAILED:${generate.status}:${String(generate.body.error ?? '')}`);
    }

    const final = await waitForReady(base, accessToken, jobId);
    if (final.status !== 'READY') {
      throw new Error(`JOB_NOT_READY:${final.status}`);
    }

    const assets = await requestApi(base, `/v1/jobs/${jobId}/assets`, {
      method: 'GET',
      token: accessToken
    });

    if (assets.status !== 200) {
      throw new Error(`ASSETS_FETCH_FAILED:${assets.status}`);
    }

    const entries = Array.isArray(assets.body.assets) ? (assets.body.assets as JsonObject[]) : [];
    const finalVideo = entries.find((entry) => String(entry.kind ?? '') === 'final_video');
    if (!finalVideo) {
      throw new Error('FINAL_VIDEO_ASSET_MISSING');
    }

    const signedUrl = String(finalVideo.signedUrl ?? '');
    if (!signedUrl) {
      throw new Error('FINAL_VIDEO_SIGNED_URL_MISSING');
    }

    const probe = await fetch(signedUrl);
    const probeBytes = Buffer.from(await probe.arrayBuffer()).length;
    if (!probe.ok) {
      throw new Error(`FINAL_VIDEO_PROBE_FAILED:${probe.status}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          port,
          emailDomain,
          signupStatus,
          signupMode,
          signupError,
          publicSignupMode,
          requiresEmailConfirmation,
          emailConfirmStatus: confirmStatus,
          emailConfirmVia: confirmVia,
          loginStatus: login.status,
          entitlementReason: String(me.body.reason ?? ''),
          canRunJob,
          projectCreateStatus: createProject.status,
          selectStatus: select.status,
          generateStatus: generate.status,
          jobStatus: final.status,
          assetsStatus: assets.status,
          finalVideoObjectPath: String(finalVideo.objectPath ?? ''),
          signedUrlProbeStatus: probe.status,
          signedUrlProbeBytes: probeBytes
        },
        null,
        2
      )
    );

    exitCode = 0;
  } catch (error) {
    console.error(`FREE_CUSTOMER_FLOW_SMOKE_FAILED:${String((error as Error)?.message ?? error)}`);
    exitCode = 1;
  } finally {
    await deleteUser(createdUserId);
    await cleanupResources(server);

    if (prevAuthRequired === undefined) delete process.env.AUTH_REQUIRED;
    else process.env.AUTH_REQUIRED = prevAuthRequired;

    if (prevAutoPublish === undefined) delete process.env.ENABLE_AUTO_PUBLISH;
    else process.env.ENABLE_AUTO_PUBLISH = prevAutoPublish;

    if (prevFreePlan === undefined) delete process.env.ENABLE_FREE_PLAN_MVP;
    else process.env.ENABLE_FREE_PLAN_MVP = prevFreePlan;
  }

  process.exit(exitCode);
};

run().catch((error) => {
  console.error(`FREE_CUSTOMER_FLOW_SMOKE_FATAL:${String((error as Error)?.message ?? error)}`);
  process.exit(1);
});
