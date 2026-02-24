import { randomUUID } from 'node:crypto';
import { getPersistenceBackend } from './persistence/backend.ts';
import { postgresProjectRepo } from './persistence/postgres-project-repo.ts';

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
  if (getPersistenceBackend() === 'postgres') {
    return postgresProjectRepo.create(input);
  }

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
  if (getPersistenceBackend() === 'postgres') {
    return postgresProjectRepo.getById(projectId);
  }
  return projects.get(projectId) ?? null;
};

export const listProjects = (): ProjectRecord[] => {
  if (getPersistenceBackend() === 'postgres') {
    return postgresProjectRepo.list();
  }
  return Array.from(projects.values());
};

export const setProjectStatus = (projectId: string, status: ProjectRecord['status']): ProjectRecord | null => {
  if (getPersistenceBackend() === 'postgres') {
    return postgresProjectRepo.setStatus(projectId, status);
  }

  const record = projects.get(projectId);
  if (!record) return null;
  record.status = status;
  projects.set(projectId, record);
  return record;
};
