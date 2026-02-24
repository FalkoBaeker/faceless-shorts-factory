import { reserveCredit, commitCredit, releaseCredit, listLedger } from './services/billing-service.ts';

const org = 'org_pg_ledger_probe';
const jobA = 'job_pg_ledger_a';
const jobB = 'job_pg_ledger_b';

reserveCredit(org, jobA);
commitCredit(org, jobA);
reserveCredit(org, jobB);
releaseCredit(org, jobB);

const entries = listLedger(org);
const types = entries.map((e) => e.type);

console.log(
  JSON.stringify(
    {
      ok: types.join(',') === 'RESERVED,COMMITTED,RESERVED,RELEASED',
      entryCount: entries.length,
      types
    },
    null,
    2
  )
);
