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

const createSmokeUser = async (email: string, password: string) => {
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
    throw new Error(`AUTH_ADMIN_CREATE_FAILED:${created.status}`);
  }

  return String((created.body?.user as JsonObject | undefined)?.id ?? '');
};

const deleteSmokeUser = async (userId: string) => {
  if (!userId) return;
  await supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' }, true);
};

const run = async () => {
  const prevAuthRequired = process.env.AUTH_REQUIRED;
  const prevAlertTarget = process.env.ALERT_TARGET;
  const prevAlertSeverities = process.env.ALERT_EMAIL_SEVERITIES;
  const prevAlertAllowed = process.env.ALERT_TEST_ALLOWED;

  process.env.AUTH_REQUIRED = 'true';
  process.env.ALERT_TARGET = 'email';
  process.env.ALERT_EMAIL_SEVERITIES = 'critical,warn';
  process.env.ALERT_TEST_ALLOWED = 'true';

  const { server, port } = await startApiServer(0);
  const base = `http://127.0.0.1:${port}`;

  const email = `alert-smoke-${Date.now()}@googlemail.com`;
  const password = `AlertSmoke_${Date.now()}_A!`;
  let userId = '';
  let exitCode = 0;

  try {
    userId = await createSmokeUser(email, password);

    const loginRes = await fetch(`${base}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const login = (await loginRes.json()) as JsonObject;
    const token = String(login.accessToken ?? '');

    const alertRes = await fetch(`${base}/v1/admin/alerts/test`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` }
    });
    const alert = (await alertRes.json()) as JsonObject;

    if (loginRes.status !== 200 || alertRes.status !== 200) {
      exitCode = 1;
    }

    console.log(
      JSON.stringify(
        {
          ok: exitCode === 0,
          loginStatus: loginRes.status,
          alertStatus: alertRes.status,
          alertTarget: String(alert.target ?? ''),
          alertSent: Boolean(alert.sent ?? false),
          alertDetail: String(alert.detail ?? '')
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(`ALERT_ENDPOINT_SMOKE_FAILED:${String((error as Error)?.message ?? error)}`);
    exitCode = 1;
  } finally {
    await deleteSmokeUser(userId);
    await closeServer(server);

    if (prevAuthRequired === undefined) delete process.env.AUTH_REQUIRED;
    else process.env.AUTH_REQUIRED = prevAuthRequired;

    if (prevAlertTarget === undefined) delete process.env.ALERT_TARGET;
    else process.env.ALERT_TARGET = prevAlertTarget;

    if (prevAlertSeverities === undefined) delete process.env.ALERT_EMAIL_SEVERITIES;
    else process.env.ALERT_EMAIL_SEVERITIES = prevAlertSeverities;

    if (prevAlertAllowed === undefined) delete process.env.ALERT_TEST_ALLOWED;
    else process.env.ALERT_TEST_ALLOWED = prevAlertAllowed;
  }

  process.exit(exitCode);
};

run().catch((error) => {
  console.error(`ALERT_ENDPOINT_SMOKE_FATAL:${String((error as Error)?.message ?? error)}`);
  process.exit(1);
});
