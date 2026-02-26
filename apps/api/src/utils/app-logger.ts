import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export type AppLogPayload = {
  event: string;
  level?: LogLevel;
  jobId?: string;
  stage?: string;
  provider?: string;
  detail?: string;
  data?: Record<string, unknown>;
};

const ensureDir = (path: string) => {
  mkdirSync(dirname(path), { recursive: true });
};

const safeData = (input: Record<string, unknown> | undefined) => {
  if (!input) return undefined;
  const clone: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (/key|token|secret|password/i.test(k)) {
      clone[k] = '[redacted]';
      continue;
    }
    clone[k] = v;
  }
  return clone;
};

export const logEvent = (payload: AppLogPayload) => {
  const path = resolve(process.cwd(), process.env.APP_LOG_PATH ?? 'logs/app.log');
  ensureDir(path);

  const entry = {
    ts: new Date().toISOString(),
    level: payload.level ?? 'INFO',
    event: payload.event,
    jobId: payload.jobId,
    stage: payload.stage,
    provider: payload.provider,
    detail: payload.detail,
    data: safeData(payload.data)
  };

  const line = JSON.stringify(entry);
  appendFileSync(path, `${line}\n`, 'utf8');
  console.log(line);
};
