import { getPersistenceRuntimeMode } from './backend.ts';

export type PostgresClientInfo = {
  backend: 'postgres';
  dsnConfigured: boolean;
  mode: 'stub-memory' | 'sql';
  driver: 'none' | 'pg';
  note: string;
};

export const getPgClient = (): PostgresClientInfo => {
  const mode = getPersistenceRuntimeMode() === 'sql' ? 'sql' : 'stub-memory';

  return {
    backend: 'postgres',
    dsnConfigured: Boolean(process.env.DATABASE_URL),
    mode,
    driver: mode === 'sql' ? 'pg' : 'none',
    note:
      mode === 'sql'
        ? 'External pg driver enabled via SQL executor.'
        : 'No external pg driver enabled in runtime; using in-process adapter state.'
  };
};
