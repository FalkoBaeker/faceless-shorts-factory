import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type LoadOptions = {
  cwd?: string;
  files?: string[];
};

let loaded = false;

const parseEnvLine = (line: string): [string, string] | null => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const idx = trimmed.indexOf('=');
  if (idx <= 0) return null;

  const key = trimmed.slice(0, idx).trim();
  let value = trimmed.slice(idx + 1).trim();

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }

  return [key, value];
};

const loadEnvFile = (path: string) => {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    // explicit project env files are authoritative for this runtime
    process.env[key] = value;
  }
};

const ancestorDirs = (start: string) => {
  const dirs: string[] = [];
  let current = resolve(start);
  while (true) {
    dirs.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
};

const findFileInAncestors = (startDir: string, file: string) => {
  for (const dir of ancestorDirs(startDir)) {
    const candidate = resolve(dir, file);
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

const applySafetyDefaults = () => {
  process.env.DAILY_BUDGET_EUR ??= '10';
  process.env.MAX_PARALLEL_JOBS ??= '1';
  process.env.MAX_RPM_LLM ??= '30';
  process.env.MAX_RPM_TTS ??= '10';
  process.env.MAX_RPM_VIDEO ??= '3';
  process.env.VIDEO_POLL_TIMEOUT_MS ??= '900000';
  process.env.VIDEO_POLL_ATTEMPTS_MAX ??= '270';
  process.env.VIDEO_POLL_SLEEP_MS ??= '4000';
  process.env.E2E_JOB_TIMEOUT_MS ??= '1200000';
  process.env.APP_LOG_PATH ??= 'logs/app.log';
  process.env.PROVIDER_HEALTH_RETRIES ??= '1';

  process.env.AUTH_METHOD ??= 'email';
  process.env.AUTH_REQUIRED ??= 'false';
  process.env.WEB_ORIGIN ??= 'http://localhost:3000';

  process.env.ALERT_TARGET ??= 'logs';
  process.env.ALERT_EMAIL_SEVERITIES ??= 'critical,warn';
  process.env.ALERT_TEST_ALLOWED ??= 'false';

  process.env.ENABLE_AUTO_PUBLISH ??= 'false';
};

export const loadEnvFiles = (options?: LoadOptions) => {
  if (loaded) return;

  const cwd = options?.cwd ?? process.cwd();
  const files = options?.files ?? ['.env', '.env.providers'];

  for (const file of files) {
    const resolvedPath = findFileInAncestors(cwd, file) ?? resolve(cwd, file);
    loadEnvFile(resolvedPath);
  }

  applySafetyDefaults();
  loaded = true;
};
