import type { JobRecord, TimelineEvent } from '../job-store.ts';
import { createSqlExecutor } from './executor-factory.ts';
import { sqlTemplates } from './sql-templates.ts';
import {
  mapJobRowToDomain,
  mapJobEventRowToDomain,
  type DbJobRow,
  type DbJobEventRow
} from './sql-mappers.ts';

export const postgresJobRepo = {
  save: (job: JobRecord): void => {
    const executor = createSqlExecutor();
    const now = new Date().toISOString();

    executor.query<DbJobRow>(sqlTemplates.jobs.upsert, [job.id, job.projectId, job.status, now, now]);

    for (const event of job.timeline) {
      executor.query(sqlTemplates.jobEvents.insert, [job.id, event.at, event.event, event.detail ?? null]);
    }
  },

  getById: (jobId: string): JobRecord | null => {
    const executor = createSqlExecutor();
    const { rows } = executor.query<DbJobRow>(sqlTemplates.jobs.getById, [jobId]);
    const row = rows[0];
    if (!row) return null;

    const base = mapJobRowToDomain(row);
    const events = executor
      .query<DbJobEventRow>(sqlTemplates.jobEvents.listByJob, [jobId])
      .rows.map(mapJobEventRowToDomain);

    return {
      ...base,
      timeline: events
    };
  },

  list: (): JobRecord[] => {
    const executor = createSqlExecutor();
    const rows = executor.query<DbJobRow>(sqlTemplates.jobs.list, []).rows;
    return rows.map(mapJobRowToDomain);
  },

  appendEvent: (jobId: string, event: TimelineEvent): JobRecord | null => {
    const executor = createSqlExecutor();
    const job = postgresJobRepo.getById(jobId);
    if (!job) return null;

    executor.query(sqlTemplates.jobEvents.insert, [jobId, event.at, event.event, event.detail ?? null]);

    return postgresJobRepo.getById(jobId);
  }
};
