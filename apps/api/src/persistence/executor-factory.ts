import { getPersistenceRuntimeMode } from './backend.ts';
import type { SqlExecutor } from './driver-contract.ts';
import { sqlTemplates } from './sql-templates.ts';
import type { DbProjectRow, DbJobRow } from './sql-mappers.ts';

type DbJobEventRow = { job_id: string; at: string; event: string; detail: string | null };

type InMemorySqlState = {
  projects: Map<string, DbProjectRow>;
  jobs: Map<string, DbJobRow>;
  jobEvents: DbJobEventRow[];
};

const state: InMemorySqlState = {
  projects: new Map(),
  jobs: new Map(),
  jobEvents: []
};

const runStubQuery: SqlExecutor['query'] = (sql, params = []) => {
  const p = params as any[];

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
    const row: DbJobRow = {
      id: p[0],
      project_id: p[1],
      status: p[2],
      created_at: p[3],
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

  throw new Error(`SQL_TEMPLATE_NOT_SUPPORTED:${sql}`);
};

export const createSqlExecutor = (): SqlExecutor => {
  const mode = getPersistenceRuntimeMode();

  if (mode === 'sql') {
    throw new Error('SQL_DRIVER_NOT_WIRED: approval + driver integration pending');
  }

  return {
    query: runStubQuery
  };
};
