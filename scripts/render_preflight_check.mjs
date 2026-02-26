#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = process.cwd();

const loadEnvFile = (path) => {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
};

loadEnvFile(resolve(cwd, '.env'));
loadEnvFile(resolve(cwd, '.env.providers'));

const token = process.env.RENDER_API_KEY;
const ownerName = (process.env.RENDER_OWNER_NAME ?? 'faceless').trim();
const requiredServices = (process.env.RENDER_REQUIRED_SERVICES ?? 'api,web,postgres,redis')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);

const requiredApiEnv = [
  'DATABASE_URL',
  'REDIS_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_STORAGE_BUCKET',
  'OPENAI_API_KEY',
  'ELEVENLABS_API_KEY',
  'AUTH_REQUIRED',
  'ADMIN_ALLOWLIST',
  'ALERT_TARGET',
  'ALERT_EMAIL_SEVERITIES',
  'ALERT_TEST_ALLOWED',
  'WEB_ORIGIN',
  'ENABLE_AUTO_PUBLISH'
];

const requiredWebEnv = ['NEXT_PUBLIC_API_BASE_URL'];

const missingEnv = (keys) => keys.filter((key) => !String(process.env[key] ?? '').trim());

if (!token) {
  console.error('NO_RENDER_API_KEY');
  process.exit(2);
}

const renderFetch = async (path) => {
  const res = await fetch(`https://api.render.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`RENDER_HTTP_${res.status}:${JSON.stringify(json).slice(0, 180)}`);
  }

  return json;
};

const listOwners = async () => {
  const rows = await renderFetch('/owners');
  return Array.isArray(rows) ? rows.map((x) => x.owner).filter(Boolean) : [];
};

const listServices = async (ownerId) => {
  const rows = await renderFetch(`/services?ownerId=${encodeURIComponent(ownerId)}`);
  if (!Array.isArray(rows)) return [];
  return rows.map((x) => x.service).filter(Boolean);
};

const run = async () => {
  const owners = await listOwners();
  const owner = owners.find((x) => x?.name === ownerName);

  if (!owner) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          error: `OWNER_NOT_FOUND:${ownerName}`,
          availableOwners: owners.map((x) => x?.name).filter(Boolean)
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  const services = await listServices(owner.id);
  const serviceNames = services.map((x) => x?.name).filter(Boolean);

  const missing = requiredServices.filter((required) => {
    const r = required.toLowerCase();
    return !serviceNames.some((name) => name.toLowerCase().includes(r));
  });

  const missingApiVars = missingEnv(requiredApiEnv);
  const missingWebVars = missingEnv(requiredWebEnv);

  const ok = missing.length === 0 && missingApiVars.length === 0 && missingWebVars.length === 0;

  console.log(
    JSON.stringify(
      {
        ok,
        owner: { id: owner.id, name: owner.name, type: owner.type },
        serviceCount: services.length,
        services: services.map((x) => ({ id: x.id, name: x.name, type: x.type })),
        requiredServices,
        missingServices: missing,
        missingApiVars,
        missingWebVars
      },
      null,
      2
    )
  );

  if (!ok) process.exit(1);
};

run().catch((error) => {
  console.error(`RENDER_PREFLIGHT_FAILED:${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
