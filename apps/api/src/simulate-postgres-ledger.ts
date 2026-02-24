import { createProject } from './project-store.ts';
import { startJob } from './services/job-service.ts';
import { reserveCredit, commitCredit, releaseCredit, listLedger } from './services/billing-service.ts';

const org = 'org_pg_ledger_probe';

const project = createProject({
  organizationId: org,
  topic: 'PG ledger probe',
  language: 'de',
  voice: 'de_female_01',
  variantType: 'SHORT_15'
});

const jobA = startJob({ projectId: project.id, variantType: 'SHORT_15' }).id;
const jobB = startJob({ projectId: project.id, variantType: 'SHORT_15' }).id;

reserveCredit(org, jobA);
commitCredit(org, jobA);
reserveCredit(org, jobB);
releaseCredit(org, jobB);

const entries = listLedger(org);
const types = entries.map((e) => e.type);

console.log(
  JSON.stringify(
    {
      ok: types.slice(-4).join(',') === 'RESERVED,COMMITTED,RESERVED,RELEASED',
      entryCount: entries.length,
      types
    },
    null,
    2
  )
);
