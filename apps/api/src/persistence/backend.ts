export type PersistenceBackend = 'memory' | 'postgres';
export type PersistenceRuntimeMode = 'memory' | 'stub-memory' | 'sql';

export const getPersistenceBackend = (): PersistenceBackend => {
  return process.env.PERSISTENCE_BACKEND === 'postgres' ? 'postgres' : 'memory';
};

export const getPersistenceRuntimeMode = (): PersistenceRuntimeMode => {
  const backend = getPersistenceBackend();
  if (backend === 'memory') return 'memory';
  return process.env.POSTGRES_DRIVER_AVAILABLE === 'true' ? 'sql' : 'stub-memory';
};
