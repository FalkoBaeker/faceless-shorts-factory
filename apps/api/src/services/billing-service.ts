import type { CreditLedgerEntry, CreditLedgerEntryType } from '../../../../packages/shared/src/credit-ledger.ts';
import { calculateBalance } from '../../../../packages/shared/src/credit-ledger.ts';
import { getPersistenceBackend } from '../persistence/backend.ts';
import { postgresSkeleton } from '../persistence/postgres-skeleton.ts';

const ledgerEntries: CreditLedgerEntry[] = [];
const finalizedJobs = new Set<string>();
const reservedJobs = new Set<string>();

const pushEntry = (organizationId: string, amount: number, type: CreditLedgerEntryType, jobId?: string, note?: string) => {
  const entry: CreditLedgerEntry = {
    id: `${type}_${ledgerEntries.length + 1}`,
    organizationId,
    jobId,
    amount,
    type,
    note,
    createdAt: new Date().toISOString()
  };
  ledgerEntries.push(entry);
  return entry;
};

export const reserveCredit = (organizationId: string, jobId: string) => {
  if (getPersistenceBackend() === 'postgres') {
    return postgresSkeleton.reserveCredit() as never;
  }
  if (reservedJobs.has(jobId)) return null;
  reservedJobs.add(jobId);
  return pushEntry(organizationId, -1, 'RESERVED', jobId, 'credit reserved before generation');
};

export const commitCredit = (organizationId: string, jobId: string) => {
  if (getPersistenceBackend() === 'postgres') {
    return postgresSkeleton.commitCredit() as never;
  }
  if (!reservedJobs.has(jobId) || finalizedJobs.has(jobId)) return null;
  finalizedJobs.add(jobId);
  return pushEntry(organizationId, 0, 'COMMITTED', jobId, 'reserved credit committed on READY');
};

export const releaseCredit = (organizationId: string, jobId: string) => {
  if (getPersistenceBackend() === 'postgres') {
    return postgresSkeleton.releaseCredit() as never;
  }
  if (!reservedJobs.has(jobId) || finalizedJobs.has(jobId)) return null;
  finalizedJobs.add(jobId);
  return pushEntry(organizationId, +1, 'RELEASED', jobId, 'reserved credit released after failure');
};

export const listLedger = (organizationId?: string) => {
  if (getPersistenceBackend() === 'postgres') {
    return postgresSkeleton.listLedger() as never;
  }
  return organizationId ? ledgerEntries.filter((e) => e.organizationId === organizationId) : ledgerEntries;
};

export const getLedgerBalance = (organizationId: string) => {
  return calculateBalance(listLedger(organizationId));
};
