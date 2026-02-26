import type { Server } from 'node:http';
import { startApiServer } from './server.ts';

type JsonObject = Record<string, unknown>;

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
    setTimeout(() => finish(), 2_000).unref();
  });
};

const requiredEnv = (name: string) => {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`ENV_MISSING:${name}`);
  return value;
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

  const text = await res.text();
  let body: JsonObject = {};
  if (text) {
    try {
      body = JSON.parse(text) as JsonObject;
    } catch {
      body = { raw: text };
    }
  }

  return { status: res.status, body };
};

const createAdminSmokeUser = async (email: string, password: string) => {
  const created = await supabaseRequest(
    '/auth/v1/admin/users',
    {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { plan: 'beta', smoke: true }
      })
    },
    true
  );

  if (![200, 201, 422].includes(created.status)) {
    throw new Error(`AUTH_ADMIN_CREATE_FAILED:${created.status}:${String(created.body?.msg ?? created.body?.error ?? '')}`);
  }

  return created;
};

const deleteAdminSmokeUser = async (userId: string) => {
  if (!userId) return;
  await supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' }, true);
};

const run = async () => {
  const prevAuthRequired = process.env.AUTH_REQUIRED;
  process.env.AUTH_REQUIRED = 'true';

  const { server, port } = await startApiServer(0);
  const base = `http://127.0.0.1:${port}`;
  const emailDomain = process.env.AUTH_SMOKE_EMAIL_DOMAIN?.trim() || 'googlemail.com';
  const email = `faceless-smoke-${Date.now()}@${emailDomain}`;
  const password = `SmokePass_${Date.now()}_A!`;

  let exitCode = 0;
  let createdUserId = '';

  try {
    const adminCreated = await createAdminSmokeUser(email, password);
    createdUserId = String((adminCreated.body?.user as JsonObject | undefined)?.id ?? '');

    const loginRes = await fetch(`${base}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const login = (await loginRes.json()) as JsonObject;

    const accessToken = String(login.accessToken ?? '');
    if (loginRes.status !== 200 || !accessToken) {
      exitCode = 1;
    }

    let meStatus = 0;
    let createProjectStatus = 0;

    if (accessToken) {
      const meRes = await fetch(`${base}/v1/auth/me`, {
        headers: { authorization: `Bearer ${accessToken}` }
      });
      meStatus = meRes.status;

      const projectRes = await fetch(`${base}/v1/projects`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          organizationId: 'org_auth_smoke',
          topic: 'Auth smoke project',
          language: 'de',
          voice: 'de_female_01',
          variantType: 'SHORT_15'
        })
      });
      createProjectStatus = projectRes.status;

      if (meStatus !== 200 || createProjectStatus !== 201) {
        exitCode = 1;
      }
    }

    console.log(
      JSON.stringify(
        {
          ok: exitCode === 0,
          port,
          emailDomain,
          adminCreateStatus: adminCreated.status,
          loginStatus: loginRes.status,
          hasAccessToken: Boolean(accessToken),
          loginReason: String(login.reason ?? ''),
          meStatus,
          createProjectStatus
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(`AUTH_FLOW_SMOKE_FAILED:${String((error as Error)?.message ?? error)}`);
    exitCode = 1;
  } finally {
    await deleteAdminSmokeUser(createdUserId);
    await closeServer(server);

    if (prevAuthRequired === undefined) {
      delete process.env.AUTH_REQUIRED;
    } else {
      process.env.AUTH_REQUIRED = prevAuthRequired;
    }
  }

  process.exit(exitCode);
};

run().catch((error) => {
  console.error(`AUTH_FLOW_SMOKE_FATAL:${String((error as Error)?.message ?? error)}`);
  process.exit(1);
});
