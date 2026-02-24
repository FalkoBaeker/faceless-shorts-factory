export type CreditLedgerEntryType =
  | 'TOPUP'
  | 'RESERVED'
  | 'COMMITTED'
  | 'RELEASED'
  | 'MANUAL_ADJUSTMENT';

export type CreditLedgerEntry = {
  id: string;
  organizationId: string;
  jobId?: string;
  amount: number;
  type: CreditLedgerEntryType;
  createdAt: string;
  note?: string;
};

export function calculateBalance(entries: CreditLedgerEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.amount, 0);
}
