import type { AdminSnapshotResponse } from '../contracts.ts';
import { listProjects } from '../project-store.ts';
import { listJobs } from '../job-store.ts';
import { listLedger } from './billing-service.ts';
import { getPublishedJobsCount } from './publish-service.ts';
import { getProviderHealthSnapshot } from '../providers/live-provider-runtime.ts';

export const getAdminSnapshot = (): AdminSnapshotResponse => {
  const jobs = listJobs();
  const providerHealth = getProviderHealthSnapshot();

  return {
    totals: {
      projects: listProjects().length,
      jobs: jobs.length,
      jobsReady: jobs.filter((j) => j.status === 'READY').length,
      jobsFailed: jobs.filter((j) => j.status === 'FAILED').length,
      jobsPublished: getPublishedJobsCount(),
      ledgerEntries: listLedger().length
    },
    providerHealth
  };
};
