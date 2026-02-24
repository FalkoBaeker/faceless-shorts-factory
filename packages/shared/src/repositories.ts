import type { CreditLedgerEntry } from './credit-ledger.ts';

export type VariantType = 'SHORT_15' | 'MASTER_30';

export type ProjectRecord = {
  id: string;
  organizationId: string;
  topic: string;
  language: string;
  voice: string;
  variantType: VariantType;
  status: 'DRAFT' | 'IDEATION_PENDING' | 'IDEATION_READY' | 'SELECTED';
  createdAt: string;
};

export type JobTimelineEvent = { at: string; event: string; detail?: string };

export type JobRecord = {
  id: string;
  projectId: string;
  status: string;
  timeline: JobTimelineEvent[];
};

export type PublishTarget = 'tiktok' | 'instagram' | 'youtube';

export type PublishPost = {
  target: PublishTarget;
  postUrl: string;
};

export type ProjectRepository = {
  create: (input: Omit<ProjectRecord, 'id' | 'status' | 'createdAt'>) => Promise<ProjectRecord>;
  getById: (projectId: string) => Promise<ProjectRecord | null>;
  list: () => Promise<ProjectRecord[]>;
  setStatus: (projectId: string, status: ProjectRecord['status']) => Promise<ProjectRecord | null>;
};

export type JobRepository = {
  save: (job: JobRecord) => Promise<void>;
  getById: (jobId: string) => Promise<JobRecord | null>;
  list: () => Promise<JobRecord[]>;
  appendEvent: (jobId: string, event: JobTimelineEvent) => Promise<JobRecord | null>;
};

export type LedgerRepository = {
  reserve: (organizationId: string, jobId: string) => Promise<CreditLedgerEntry | null>;
  commit: (organizationId: string, jobId: string) => Promise<CreditLedgerEntry | null>;
  release: (organizationId: string, jobId: string) => Promise<CreditLedgerEntry | null>;
  list: (organizationId?: string) => Promise<CreditLedgerEntry[]>;
};

export type PublishRepository = {
  publishNow: (jobId: string, targets: PublishTarget[]) => Promise<PublishPost[]>;
  listForJob: (jobId: string) => Promise<PublishPost[]>;
  publishedJobsCount: () => Promise<number>;
};
