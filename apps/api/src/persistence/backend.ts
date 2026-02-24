export type PersistenceBackend = 'memory' | 'postgres';

export const getPersistenceBackend = (): PersistenceBackend => {
  return process.env.PERSISTENCE_BACKEND === 'postgres' ? 'postgres' : 'memory';
};
