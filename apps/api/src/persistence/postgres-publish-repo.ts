import type { PublishPost, PublishTarget } from '../services/publish-service.ts';
import { createSqlExecutor } from './executor-factory.ts';
import { sqlTemplates } from './sql-templates.ts';
import { mapPublishPostRowToDomain, type DbPublishPostRow } from './sql-mappers.ts';

type DbPublishJobsCountRow = { count: number };

export const postgresPublishRepo = {
  publishNow: (jobId: string, targets: PublishTarget[]): PublishPost[] => {
    const executor = createSqlExecutor();

    for (const target of targets) {
      executor.query(sqlTemplates.publishPosts.insert, [
        jobId,
        target,
        `https://social.local/${target}/${jobId}`,
        new Date().toISOString()
      ]);
    }

    const { rows } = executor.query<DbPublishPostRow>(sqlTemplates.publishPosts.listByJob, [jobId]);
    return rows.map(mapPublishPostRowToDomain);
  },

  listForJob: (jobId: string): PublishPost[] => {
    const executor = createSqlExecutor();
    const { rows } = executor.query<DbPublishPostRow>(sqlTemplates.publishPosts.listByJob, [jobId]);
    return rows.map(mapPublishPostRowToDomain);
  },

  publishedJobsCount: (): number => {
    const executor = createSqlExecutor();
    const row = executor.query<DbPublishJobsCountRow>(sqlTemplates.publishPosts.countJobs).rows[0];
    if (!row) return 0;
    return Number(row.count ?? 0);
  }
};
