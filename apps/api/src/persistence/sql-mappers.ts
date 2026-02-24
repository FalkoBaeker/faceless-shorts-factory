import type { ProjectRecord } from '../project-store.ts';
import type { JobRecord } from '../job-store.ts';
import type { CreditLedgerEntry } from '../../../../packages/shared/src/credit-ledger.ts';
import type { PublishPost } from '../services/publish-service.ts';

export type DbProjectRow = {
  id: string;
  organization_id: string;
  topic: string;
  language: string;
  voice: string;
  variant_type: 'SHORT_15' | 'MASTER_30';
  status: 'DRAFT' | 'IDEATION_PENDING' | 'IDEATION_READY' | 'SELECTED';
  created_at: string;
};

export type DbJobRow = {
  id: string;
  project_id: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type DbLedgerRow = {
  id: string;
  organization_id: string;
  job_id: string | null;
  amount: number;
  type: CreditLedgerEntry['type'];
  note: string | null;
  created_at: string;
};

export type DbPublishPostRow = {
  job_id: string;
  target: PublishPost['target'];
  post_url: string;
};

export const mapProjectRowToDomain = (row: DbProjectRow): ProjectRecord => ({
  id: row.id,
  organizationId: row.organization_id,
  topic: row.topic,
  language: row.language,
  voice: row.voice,
  variantType: row.variant_type,
  status: row.status,
  createdAt: row.created_at
});

export const mapJobRowToDomain = (row: DbJobRow): JobRecord => ({
  id: row.id,
  projectId: row.project_id,
  status: row.status,
  timeline: []
});

export const mapLedgerRowToDomain = (row: DbLedgerRow): CreditLedgerEntry => ({
  id: row.id,
  organizationId: row.organization_id,
  jobId: row.job_id ?? undefined,
  amount: row.amount,
  type: row.type,
  note: row.note ?? undefined,
  createdAt: row.created_at
});

export const mapPublishPostRowToDomain = (row: DbPublishPostRow): PublishPost => ({
  target: row.target,
  postUrl: row.post_url
});

export type DbJobEventRow = {
  job_id: string;
  at: string;
  event: string;
  detail: string | null;
};

export const mapJobEventRowToDomain = (row: DbJobEventRow) => ({
  at: row.at,
  event: row.event,
  detail: row.detail ?? undefined
});
