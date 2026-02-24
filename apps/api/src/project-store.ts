import { randomUUID } from 'node:crypto';

export type ProjectRecord = {
  id: string;
  organizationId: string;
  topic: string;
  language: string;
  voice: string;
  variantType: 'SHORT_15' | 'MASTER_30';
  status: 'DRAFT' | 'IDEATION_PENDING' | 'IDEATION_READY' | 'SELECTED';
  createdAt: string;
};

const projects = new Map<string, ProjectRecord>();

export const createProject = (input: Omit<ProjectRecord, 'id' | 'status' | 'createdAt'>): ProjectRecord => {
  const record: ProjectRecord = {
    id: randomUUID(),
    status: 'DRAFT',
    createdAt: new Date().toISOString(),
    ...input
  };

  projects.set(record.id, record);
  return record;
};

export const getProject = (projectId: string): ProjectRecord | null => {
  return projects.get(projectId) ?? null;
};

export const setProjectStatus = (projectId: string, status: ProjectRecord['status']): ProjectRecord | null => {
  const record = projects.get(projectId);
  if (!record) return null;
  record.status = status;
  projects.set(projectId, record);
  return record;
};
