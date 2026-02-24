import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import {
  createProjectHandler,
  selectConceptHandler,
  generateHandler,
  getJobHandler,
  getLedgerHandler
} from './handlers.ts';

type Json = Record<string, unknown>;

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

const handleError = (res: ServerResponse, error: unknown) => {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  sendJson(res, 400, { error: message });
};

export const buildApiServer = () =>
  createServer(async (req, res) => {
    try {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;

      if (method === 'GET' && path === '/health') {
        return sendJson(res, 200, { status: 'ok', service: 'faceless-api' });
      }

      if (method === 'POST' && path === '/v1/projects') {
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
        const body = await readJsonBody(req);
        const projectId = path.split('/')[3];
        const selected = selectConceptHandler({
          projectId,
          conceptId: String(body.conceptId ?? 'concept_1'),
          variantType: body.variantType === 'MASTER_30' ? 'MASTER_30' : 'SHORT_15'
        });
        return sendJson(res, 200, selected);
      }

      if (method === 'POST' && /^\/v1\/projects\/[^/]+\/generate$/.test(path)) {
        const body = await readJsonBody(req);
        const jobId = String(body.jobId ?? '');
        const done = generateHandler(jobId, { forceFail: Boolean(body.forceFail) });
        return sendJson(res, 200, done);
      }

      if (method === 'GET' && /^\/v1\/jobs\/[^/]+$/.test(path)) {
        const jobId = path.split('/')[3];
        const current = getJobHandler(jobId);
        return sendJson(res, 200, current);
      }

      if (method === 'GET' && /^\/v1\/ledger\/[^/]+$/.test(path)) {
        const organizationId = path.split('/')[3];
        const ledger = getLedgerHandler(organizationId);
        return sendJson(res, 200, ledger);
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
