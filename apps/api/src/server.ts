import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import {
  createProjectHandler,
  selectConceptHandler,
  generateHandler,
  publishJobHandler,
  getJobHandler,
  getJobAssetsHandler,
  getLedgerHandler,
  getAdminSnapshotHandler,
  getDeadLetterHandler,
  replayDeadLetterHandler
} from './handlers.ts';
import { loadEnvFiles } from './config/env-loader.ts';
import {
  authRequired,
  requireRequestUser,
  resolveRequestUser,
  signupWithEmailPassword,
  loginWithEmailPassword
} from './services/auth-service.ts';
import {
  assertCanPublish,
  assertCanRunJob,
  canRunJob,
  registerJobConsumption
} from './services/entitlement-service.ts';
import { sendStandardTestAlert } from './services/alert-service.ts';

loadEnvFiles();

type Json = Record<string, unknown>;

const parseOrigins = () => {
  const raw = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  return new Set(
    raw
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  );
};

const allowedOrigins = parseOrigins();

const applyCors = (req: IncomingMessage, res: ServerResponse) => {
  const origin = req.headers.origin;

  if (!origin) {
    res.setHeader('access-control-allow-origin', '*');
  } else if (allowedOrigins.has(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
  }

  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,authorization');
  res.setHeader('access-control-max-age', '86400');
};

const readJsonBody = async (req: IncomingMessage): Promise<Json> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? (JSON.parse(raw) as Json) : {};
};

const sendJson = (res: ServerResponse, statusCode: number, body: unknown) => {
  const payload = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(payload));
  res.end(payload);
};

const statusFromMessage = (message: string) => {
  if (/^AUTH_REQUIRED|^AUTH_PROVIDER_401|^AUTH_PROVIDER_403|^AUTH_INVALID/.test(message)) return 401;
  if (/^NOT_ENTITLED|^ALERT_TEST_NOT_ALLOWED/.test(message)) return 403;
  if (/NOT_FOUND/.test(message)) return 404;
  return 400;
};

const handleError = (res: ServerResponse, error: unknown) => {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  const statusCode = statusFromMessage(message);
  sendJson(res, statusCode, { error: message });
};

const testAlertAllowed = () => (process.env.ALERT_TEST_ALLOWED ?? 'false').trim().toLowerCase() === 'true';
const autoPublishEnabled = () => (process.env.ENABLE_AUTO_PUBLISH ?? 'false').trim().toLowerCase() === 'true';

const ensureRunPermissionIfRequired = async (req: IncomingMessage) => {
  if (!authRequired()) return null;
  const user = await requireRequestUser(req);
  await assertCanRunJob(user);
  return user;
};

const ensurePublishPermissionIfRequired = async (req: IncomingMessage) => {
  if (!authRequired()) return null;
  const user = await requireRequestUser(req);
  await assertCanPublish(user);
  return user;
};

const ensureAuthIfRequired = async (req: IncomingMessage) => {
  if (!authRequired()) return null;
  return requireRequestUser(req);
};

export const buildApiServer = () =>
  createServer(async (req, res) => {
    applyCors(req, res);

    if ((req.method ?? 'GET') === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;

      if (method === 'GET' && path === '/health') {
        return sendJson(res, 200, { status: 'ok', service: 'faceless-api', authRequired: authRequired() });
      }

      if (method === 'POST' && path === '/v1/auth/signup') {
        const body = await readJsonBody(req);
        const email = String(body.email ?? '').trim();
        const password = String(body.password ?? '');
        if (!email || password.length < 8) {
          throw new Error('AUTH_INPUT_INVALID:email/password');
        }

        const session = await signupWithEmailPassword(email, password);
        const entitlement = await canRunJob(session.user);

        return sendJson(res, 200, {
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiresIn: session.expiresIn,
          requiresEmailConfirmation: session.requiresEmailConfirmation,
          user: {
            id: session.user.id,
            email: session.user.email,
            plan: entitlement.record.plan,
            subscriptionStatus: entitlement.record.subscriptionStatus,
            allowlisted: entitlement.record.allowlisted
          },
          canRunJob: entitlement.allow,
          reason: entitlement.reason
        });
      }

      if (method === 'POST' && path === '/v1/auth/login') {
        const body = await readJsonBody(req);
        const email = String(body.email ?? '').trim();
        const password = String(body.password ?? '');
        if (!email || !password) {
          throw new Error('AUTH_INPUT_INVALID:email/password');
        }

        const session = await loginWithEmailPassword(email, password);
        const entitlement = await canRunJob(session.user);

        return sendJson(res, 200, {
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiresIn: session.expiresIn,
          requiresEmailConfirmation: session.requiresEmailConfirmation,
          user: {
            id: session.user.id,
            email: session.user.email,
            plan: entitlement.record.plan,
            subscriptionStatus: entitlement.record.subscriptionStatus,
            allowlisted: entitlement.record.allowlisted
          },
          canRunJob: entitlement.allow,
          reason: entitlement.reason
        });
      }

      if (method === 'GET' && path === '/v1/auth/me') {
        const user = await resolveRequestUser(req);
        if (!user) {
          if (authRequired()) throw new Error('AUTH_REQUIRED');
          return sendJson(res, 200, {
            authenticated: false,
            authRequired: false,
            canRunJob: true,
            reason: 'AUTH_OPTIONAL_MODE'
          });
        }

        const entitlement = await canRunJob(user);
        return sendJson(res, 200, {
          authenticated: true,
          authRequired: authRequired(),
          canRunJob: entitlement.allow,
          reason: entitlement.reason,
          user: {
            id: user.id,
            email: user.email,
            plan: entitlement.record.plan,
            subscriptionStatus: entitlement.record.subscriptionStatus,
            allowlisted: entitlement.record.allowlisted,
            creditsRemaining: entitlement.record.creditsRemaining,
            monthlyJobLimit: entitlement.record.monthlyJobLimit,
            jobsUsed: entitlement.record.jobsUsed
          }
        });
      }

      if (method === 'POST' && path === '/v1/projects') {
        await ensureRunPermissionIfRequired(req);

        const body = await readJsonBody(req);
        const created = createProjectHandler({
          organizationId: String(body.organizationId ?? ''),
          topic: String(body.topic ?? ''),
          language: String(body.language ?? 'de'),
          voice: String(body.voice ?? 'de_female_01'),
          variantType: body.variantType === 'MASTER_30' ? 'MASTER_30' : 'SHORT_15'
        });
        return sendJson(res, 201, created);
      }

      if (method === 'POST' && /^\/v1\/projects\/[^/]+\/select$/.test(path)) {
        const user = await ensureRunPermissionIfRequired(req);

        const body = await readJsonBody(req);
        const projectId = path.split('/')[3];
        const selected = selectConceptHandler({
          projectId,
          conceptId: String(body.conceptId ?? 'concept_1'),
          startFrameStyle: String(body.startFrameStyle ?? 'storefront_hero') as
            | 'storefront_hero'
            | 'product_macro'
            | 'owner_portrait'
            | 'hands_at_work'
            | 'before_after_split',
          variantType: body.variantType === 'MASTER_30' ? 'MASTER_30' : 'SHORT_15'
        });

        if (user) {
          await registerJobConsumption(user);
        }

        return sendJson(res, 200, selected);
      }

      if (method === 'POST' && /^\/v1\/projects\/[^/]+\/generate$/.test(path)) {
        await ensureRunPermissionIfRequired(req);

        const body = await readJsonBody(req);
        const jobId = String(body.jobId ?? '');
        const done = await generateHandler(jobId, { forceFail: Boolean(body.forceFail) });
        return sendJson(res, 200, done);
      }

      if (method === 'POST' && /^\/v1\/jobs\/[^/]+\/publish$/.test(path)) {
        if (!autoPublishEnabled()) {
          throw new Error('NOT_ENTITLED:FEATURE_DISABLED_MVP');
        }

        await ensurePublishPermissionIfRequired(req);

        const body = await readJsonBody(req);
        const jobId = path.split('/')[3];
        const parsedTargets = Array.isArray(body.targets) ? body.targets : ['tiktok', 'instagram'];
        const targets = parsedTargets
          .map((x) => String(x))
          .filter((x): x is 'tiktok' | 'instagram' | 'youtube' => ['tiktok', 'instagram', 'youtube'].includes(x));
        const published = await publishJobHandler(jobId, targets.length ? targets : ['tiktok', 'instagram']);
        return sendJson(res, 200, published);
      }

      if (method === 'GET' && /^\/v1\/jobs\/[^/]+$/.test(path)) {
        await ensureAuthIfRequired(req);
        const jobId = path.split('/')[3];
        const current = getJobHandler(jobId);
        return sendJson(res, 200, current);
      }

      if (method === 'GET' && /^\/v1\/jobs\/[^/]+\/assets$/.test(path)) {
        await ensureAuthIfRequired(req);
        const jobId = path.split('/')[3];
        const assets = getJobAssetsHandler(jobId);
        return sendJson(res, 200, assets);
      }

      if (method === 'GET' && /^\/v1\/ledger\/[^/]+$/.test(path)) {
        await ensureAuthIfRequired(req);
        const organizationId = path.split('/')[3];
        const ledger = getLedgerHandler(organizationId);
        return sendJson(res, 200, ledger);
      }

      if (method === 'GET' && path === '/v1/admin/snapshot') {
        await ensureAuthIfRequired(req);
        const admin = getAdminSnapshotHandler();
        return sendJson(res, 200, admin);
      }

      if (method === 'POST' && path === '/v1/admin/alerts/test') {
        await ensureAuthIfRequired(req);
        if (!testAlertAllowed()) throw new Error('ALERT_TEST_NOT_ALLOWED');

        const sent = await sendStandardTestAlert();
        return sendJson(res, 200, { ok: true, ...sent });
      }

      if (method === 'GET' && path === '/v1/dlq') {
        await ensureAuthIfRequired(req);
        const dlq = await getDeadLetterHandler();
        return sendJson(res, 200, dlq);
      }

      if (method === 'POST' && /^\/v1\/dlq\/[^/]+\/replay$/.test(path)) {
        await ensureAuthIfRequired(req);
        const deadLetterId = decodeURIComponent(path.split('/')[3]);
        const replayed = await replayDeadLetterHandler(deadLetterId);
        return sendJson(res, 200, replayed);
      }

      return sendJson(res, 404, { error: 'NOT_FOUND', method, path });
    } catch (error) {
      return handleError(res, error);
    }
  });

export const startApiServer = (port = 3001) => {
  const server = buildApiServer();

  return new Promise<{ server: ReturnType<typeof buildApiServer>; port: number }>((resolve) => {
    server.listen(port, () => {
      const address = server.address();
      const resolvedPort = typeof address === 'object' && address ? address.port : port;
      resolve({ server, port: resolvedPort });
    });
  });
};
