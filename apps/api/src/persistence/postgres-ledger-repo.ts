import type { CreditLedgerEntry } from '../../../../packages/shared/src/credit-ledger.ts';
import { getPgClient } from './postgres-client.ts';

const entries: CreditLedgerEntry[] = [];
const reservedJobs = new Set<string>();
const finalizedJobs = new Set<string>();

const push = (organizationId: string, amount: number, type: CreditLedgerEntry['type'], jobId: string, note: string) => {
  const entry: CreditLedgerEntry = {
    id: `${type}_${entries.length + 1}`,
    organizationId,
    jobId,
    amount,
    type,
    note,
    createdAt: new Date().toISOString()
  };
  entries.push(entry);
  return entry;
};

export const postgresLedgerRepo = {
  reserve: (organizationId: string, jobId: string): CreditLedgerEntry | null => {
    getPgClient();
    if (reservedJobs.has(jobId)) return null;
    reservedJobs.add(jobId);
    return push(organizationId, -1, 'RESERVED', jobId, 'postgres-adapter reserve');
  },

  commit: (organizationId: string, jobId: string): CreditLedgerEntry | null => {
    getPgClient();
    if (!reservedJobs.has(jobId) || finalizedJobs.has(jobId)) return null;
    finalizedJobs.add(jobId);
    return push(organizationId, 0, 'COMMITTED', jobId, 'postgres-adapter commit');
  },

  release: (organizationId: string, jobId: string): CreditLedgerEntry | null => {
    getPgClient();
    if (!reservedJobs.has(jobId) || finalizedJobs.has(jobId)) return null;
    finalizedJobs.add(jobId);
    return push(organizationId, +1, 'RELEASED', jobId, 'postgres-adapter release');
  },

  list: (organizationId?: string): CreditLedgerEntry[] => {
    getPgClient();
    return organizationId ? entries.filter((e) => e.organizationId === organizationId) : entries;
  }
};
