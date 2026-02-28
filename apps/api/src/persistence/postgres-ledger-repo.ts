import { randomUUID } from 'node:crypto';
import type { CreditLedgerEntry } from '../../../../packages/shared/src/credit-ledger.ts';
import { createSqlExecutor } from './executor-factory.ts';
import { sqlTemplates } from './sql-templates.ts';
import { mapLedgerRowToDomain, type DbLedgerRow } from './sql-mappers.ts';

const listForJobRows = (jobId: string): DbLedgerRow[] => {
  const executor = createSqlExecutor();
  return executor.query<DbLedgerRow>(sqlTemplates.creditLedger.listByJob, [jobId]).rows;
};

const insertLedgerEntry = (
  organizationId: string,
  jobId: string,
  amount: number,
  type: CreditLedgerEntry['type'],
  note: string
): CreditLedgerEntry | null => {
  const executor = createSqlExecutor();
  const createdAt = new Date().toISOString();

  const { rows } = executor.query<DbLedgerRow>(sqlTemplates.creditLedger.insert, [
    randomUUID(),
    organizationId,
    jobId,
    amount,
    type,
    note,
    createdAt
  ]);

  const row = rows[0];
  return row ? mapLedgerRowToDomain(row) : null;
};

export const postgresLedgerRepo = {
  reserve: (organizationId: string, jobId: string): CreditLedgerEntry | null => {
    const existing = listForJobRows(jobId);
    if (existing.some((entry) => entry.type === 'RESERVED')) return null;
    return insertLedgerEntry(organizationId, jobId, -1, 'RESERVED', 'postgres reserve');
  },

  commit: (organizationId: string, jobId: string): CreditLedgerEntry | null => {
    const existing = listForJobRows(jobId);
    const hasReserved = existing.some((entry) => entry.type === 'RESERVED');
    const alreadyFinalized = existing.some((entry) => entry.type === 'COMMITTED' || entry.type === 'RELEASED');
    if (!hasReserved || alreadyFinalized) return null;
    return insertLedgerEntry(organizationId, jobId, 0, 'COMMITTED', 'postgres commit');
  },

  release: (organizationId: string, jobId: string): CreditLedgerEntry | null => {
    const existing = listForJobRows(jobId);
    const hasReserved = existing.some((entry) => entry.type === 'RESERVED');
    const alreadyFinalized = existing.some((entry) => entry.type === 'COMMITTED' || entry.type === 'RELEASED');
    if (!hasReserved || alreadyFinalized) return null;
    return insertLedgerEntry(organizationId, jobId, +1, 'RELEASED', 'postgres release');
  },

  list: (organizationId?: string): CreditLedgerEntry[] => {
    const executor = createSqlExecutor();
    const query = organizationId ? sqlTemplates.creditLedger.listByOrg : sqlTemplates.creditLedger.listAll;
    const params = organizationId ? [organizationId] : [];
    return executor.query<DbLedgerRow>(query, params).rows.map(mapLedgerRowToDomain);
  },

  listByJob: (jobId: string): CreditLedgerEntry[] => {
    return listForJobRows(jobId).map(mapLedgerRowToDomain);
  }
};
