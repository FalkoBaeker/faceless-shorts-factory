export const health = () => ({ status: 'ok', service: 'faceless-api' });

export const supportedVariantTypes = ['SHORT_15', 'MASTER_30', 'CUTDOWN_15_FROM_30'] as const;
export const supportedSegmentSeconds = [4, 8, 12] as const;

export * from './contracts.ts';
export * from './job-store.ts';
export * from './project-store.ts';
export * from './handlers.ts';
export * from './services/job-service.ts';
