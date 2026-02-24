import { randomUUID } from 'node:crypto';
import type { ProjectRecord } from '../project-store.ts';
import { createSqlExecutor } from './executor-factory.ts';
import { sqlTemplates } from './sql-templates.ts';
import { mapProjectRowToDomain, type DbProjectRow } from './sql-mappers.ts';

export const postgresProjectRepo = {
  create: (input: Omit<ProjectRecord, 'id' | 'status' | 'createdAt'>): ProjectRecord => {
    const executor = createSqlExecutor();
    const createdAt = new Date().toISOString();
    const id = randomUUID();

    executor.query(sqlTemplates.organizations.upsert, [
      input.organizationId,
      `Organization ${input.organizationId}`,
      'eu',
      createdAt
    ]);

    const { rows } = executor.query<DbProjectRow>(sqlTemplates.projects.insert, [
      id,
      input.organizationId,
      input.topic,
      input.language,
      input.voice,
      input.variantType,
      'DRAFT',
      createdAt
    ]);

    const row = rows[0];
    if (!row) throw new Error('POSTGRES_PROJECT_CREATE_EMPTY_RESULT');
    return mapProjectRowToDomain(row);
  },

  getById: (projectId: string): ProjectRecord | null => {
    const executor = createSqlExecutor();
    const { rows } = executor.query<DbProjectRow>(sqlTemplates.projects.getById, [projectId]);
    const row = rows[0];
    return row ? mapProjectRowToDomain(row) : null;
  },

  list: (): ProjectRecord[] => {
    const executor = createSqlExecutor();
    const { rows } = executor.query<DbProjectRow>(sqlTemplates.projects.listAll, []);
    return rows.map(mapProjectRowToDomain);
  },

  setStatus: (projectId: string, status: ProjectRecord['status']): ProjectRecord | null => {
    const executor = createSqlExecutor();
    const { rows } = executor.query<DbProjectRow>(sqlTemplates.projects.setStatus, [projectId, status]);
    const row = rows[0];
    return row ? mapProjectRowToDomain(row) : null;
  }
};
