import { spawnSync } from 'node:child_process';
import { getPersistenceRuntimeMode } from './backend.ts';
import type { SqlExecutor } from './driver-contract.ts';
import { sqlTemplates } from './sql-templates.ts';
import type { DbProjectRow, DbJobRow, DbJobEventRow, DbLedgerRow, DbPublishPostRow } from './sql-mappers.ts';

type DbOrganizationRow = { id: string; name: string; region: string | null; created_at: string };
type DbPublishedJobsCountRow = { count: number };

type InMemorySqlState = {
  organizations: Map<string, DbOrganizationRow>;
  projects: Map<string, DbProjectRow>;
  jobs: Map<string, DbJobRow>;
  jobEvents: DbJobEventRow[];
  ledger: DbLedgerRow[];
  publishPosts: Array<DbPublishPostRow & { created_at: string }>;
};

const state: InMemorySqlState = {
  organizations: new Map(),
  projects: new Map(),
  jobs: new Map(),
  jobEvents: [],
  ledger: [],
  publishPosts: []
};

const runStubQuery: SqlExecutor['query'] = (sql, params = []) => {
  const p = params as any[];

  if (sql === sqlTemplates.organizations.upsert) {
    const existing = state.organizations.get(String(p[0]));
    if (existing) return { rows: [] };
    const row: DbOrganizationRow = {
      id: p[0],
      name: p[1],
      region: (p[2] ?? null) as string | null,
      created_at: p[3]
    };
    state.organizations.set(row.id, row);
    return { rows: [row] };
  }

  if (sql === sqlTemplates.projects.insert) {
    const row: DbProjectRow = {
      id: p[0],
      organization_id: p[1],
      topic: p[2],
      language: p[3],
      voice: p[4],
      variant_type: p[5],
      status: p[6],
      created_at: p[7]
    };
    state.projects.set(row.id, row);
    return { rows: [row] };
  }

  if (sql === sqlTemplates.projects.getById) {
    const row = state.projects.get(String(p[0]));
    return { rows: row ? [row] : [] };
  }

  if (sql === sqlTemplates.projects.listByOrg) {
    const orgId = String(p[0]);
    return {
      rows: Array.from(state.projects.values())
        .filter((r) => r.organization_id === orgId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
    };
  }

  if (sql === sqlTemplates.projects.listAll) {
    return {
      rows: Array.from(state.projects.values()).sort((a, b) => b.created_at.localeCompare(a.created_at))
    };
  }

  if (sql === sqlTemplates.projects.setStatus) {
    const id = String(p[0]);
    const status = p[1] as DbProjectRow['status'];
    const row = state.projects.get(id);
    if (!row) return { rows: [] };
    row.status = status;
    state.projects.set(id, row);
    return { rows: [row] };
  }

  if (sql === sqlTemplates.jobs.upsert) {
    const existing = state.jobs.get(String(p[0]));
    const row: DbJobRow = {
      id: p[0],
      project_id: p[1],
      status: p[2],
      created_at: existing?.created_at ?? p[3],
      updated_at: p[4]
    };
    state.jobs.set(row.id, row);
    return { rows: [row] };
  }

  if (sql === sqlTemplates.jobs.getById) {
    const row = state.jobs.get(String(p[0]));
    return { rows: row ? [row] : [] };
  }

  if (sql === sqlTemplates.jobs.list) {
    return {
      rows: Array.from(state.jobs.values()).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    };
  }

  if (sql === sqlTemplates.jobEvents.insert) {
    const row: DbJobEventRow = {
      job_id: p[0],
      at: p[1],
      event: p[2],
      detail: (p[3] ?? null) as string | null
    };
    state.jobEvents.push(row);
    return { rows: [row] };
  }

  if (sql === sqlTemplates.jobEvents.listByJob) {
    const jobId = String(p[0]);
    return {
      rows: state.jobEvents.filter((e) => e.job_id === jobId).sort((a, b) => a.at.localeCompare(b.at))
    };
  }

  if (sql === sqlTemplates.jobEvents.deleteByJob) {
    const jobId = String(p[0]);
    state.jobEvents = state.jobEvents.filter((event) => event.job_id !== jobId);
    return { rows: [] };
  }

  if (sql === sqlTemplates.creditLedger.insert) {
    const row: DbLedgerRow = {
      id: p[0],
      organization_id: p[1],
      job_id: (p[2] ?? null) as string | null,
      amount: Number(p[3]),
      type: p[4],
      note: (p[5] ?? null) as string | null,
      created_at: p[6]
    };
    state.ledger.push(row);
    return { rows: [row] };
  }

  if (sql === sqlTemplates.creditLedger.listByOrg) {
    const orgId = String(p[0]);
    return {
      rows: state.ledger.filter((entry) => entry.organization_id === orgId).sort((a, b) => a.created_at.localeCompare(b.created_at))
    };
  }

  if (sql === sqlTemplates.creditLedger.listByJob) {
    const jobId = String(p[0]);
    return {
      rows: state.ledger.filter((entry) => entry.job_id === jobId).sort((a, b) => a.created_at.localeCompare(b.created_at))
    };
  }

  if (sql === sqlTemplates.creditLedger.listAll) {
    return {
      rows: [...state.ledger].sort((a, b) => a.created_at.localeCompare(b.created_at))
    };
  }

  if (sql === sqlTemplates.publishPosts.insert) {
    const jobId = String(p[0]);
    const target = p[1] as DbPublishPostRow['target'];
    const post_url = String(p[2]);
    const createdAt = String(p[3]);
    const existingIndex = state.publishPosts.findIndex((row) => row.job_id === jobId && row.target === target);
    const row = { job_id: jobId, target, post_url, created_at: createdAt };
    if (existingIndex >= 0) {
      state.publishPosts[existingIndex] = row;
    } else {
      state.publishPosts.push(row);
    }
    return { rows: [row] };
  }

  if (sql === sqlTemplates.publishPosts.listByJob) {
    const jobId = String(p[0]);
    return {
      rows: state.publishPosts
        .filter((row) => row.job_id === jobId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
    };
  }

  if (sql === sqlTemplates.publishPosts.countJobs) {
    const count = new Set(state.publishPosts.map((row) => row.job_id)).size;
    return { rows: [{ count }] as DbPublishedJobsCountRow[] };
  }

  throw new Error(`SQL_TEMPLATE_NOT_SUPPORTED:${sql}`);
};

const runSqlQuery: SqlExecutor['query'] = (sql, params = []) => {
  const dsn = process.env.DATABASE_URL;
  if (!dsn) throw new Error('DATABASE_URL_MISSING_FOR_SQL_MODE');

  const script = `
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const result = await client.query(process.env.SQL, JSON.parse(process.env.PARAMS_JSON || '[]'));
  process.stdout.write(JSON.stringify(result.rows));
  await client.end();
})().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message);
  process.exit(1);
});`;

  const execution = spawnSync(process.execPath, ['-e', script], {
    env: {
      ...process.env,
      DATABASE_URL: dsn,
      SQL: sql,
      PARAMS_JSON: JSON.stringify(params)
    },
    encoding: 'utf8'
  });

  if (execution.status !== 0) {
    const errorMessage = (execution.stderr || execution.stdout || '').trim() || `exit_${execution.status}`;
    throw new Error(`SQL_DRIVER_QUERY_FAILED:${errorMessage}`);
  }

  const output = (execution.stdout || '').trim();
  if (!output) return { rows: [] };

  try {
    const rows = JSON.parse(output);
    return { rows: Array.isArray(rows) ? rows : [] };
  } catch {
    throw new Error(`SQL_DRIVER_INVALID_JSON:${output.slice(0, 180)}`);
  }
};

export const createSqlExecutor = (): SqlExecutor => {
  const mode = getPersistenceRuntimeMode();

  if (mode === 'sql') {
    return {
      query: runSqlQuery
    };
  }

  return {
    query: runStubQuery
  };
};
