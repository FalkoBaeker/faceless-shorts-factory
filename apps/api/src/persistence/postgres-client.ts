export type PostgresClientInfo = {
  backend: 'postgres';
  dsnConfigured: boolean;
  mode: 'stub-memory';
  driver: 'none';
  note: string;
};

export const getPgClient = (): PostgresClientInfo => ({
  backend: 'postgres',
  dsnConfigured: Boolean(process.env.DATABASE_URL),
  mode: 'stub-memory',
  driver: 'none',
  note: 'No external pg driver configured in this environment; using in-process adapter state for now.'
});
