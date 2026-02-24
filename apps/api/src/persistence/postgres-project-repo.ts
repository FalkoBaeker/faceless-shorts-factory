import { randomUUID } from 'node:crypto';
import type { ProjectRecord } from '../project-store.ts';
import { getPgClient } from './postgres-client.ts';

const projects = new Map<string, ProjectRecord>();

export const postgresProjectRepo = {
  create: (input: Omit<ProjectRecord, 'id' | 'status' | 'createdAt'>): ProjectRecord => {
    getPgClient();
    const record: ProjectRecord = {
      id: randomUUID(),
      status: 'DRAFT',
      createdAt: new Date().toISOString(),
      ...input
    };
    projects.set(record.id, record);
    return record;
  },

  getById: (projectId: string): ProjectRecord | null => {
    getPgClient();
    return projects.get(projectId) ?? null;
  },

  list: (): ProjectRecord[] => {
    getPgClient();
    return Array.from(projects.values());
  },

  setStatus: (projectId: string, status: ProjectRecord['status']): ProjectRecord | null => {
    getPgClient();
    const existing = projects.get(projectId);
    if (!existing) return null;
    existing.status = status;
    projects.set(projectId, existing);
    return existing;
  }
};
