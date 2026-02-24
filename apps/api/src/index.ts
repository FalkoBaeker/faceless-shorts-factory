export const health = () => ({ status: 'ok', service: 'faceless-api' });

export const supportedVariantTypes = ['SHORT_15', 'MASTER_30', 'CUTDOWN_15_FROM_30'] as const;
export const supportedSegmentSeconds = [4, 8, 12] as const;

export * from './contracts.ts';
export * from './job-store.ts';
export * from './project-store.ts';
export * from './handlers.ts';
export * from './services/job-service.ts';
export * from './services/billing-service.ts';
export * from './services/publish-service.ts';
export * from './services/admin-service.ts';
export * from './persistence/backend.ts';
export * from './persistence/postgres-skeleton.ts';
export * from './persistence/postgres-client.ts';
export * from './persistence/postgres-project-repo.ts';
export * from './persistence/postgres-job-repo.ts';
export * from './persistence/postgres-ledger-repo.ts';
export * from './persistence/postgres-publish-repo.ts';
export * from './persistence/sql-project-repo.ts';
export * from './persistence/sql-templates.ts';
export * from './persistence/sql-mappers.ts';
