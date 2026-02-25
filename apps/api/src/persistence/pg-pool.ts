import { Pool, type PoolClient, type QueryResultRow } from 'pg';

let pool: Pool | null = null;

const getPool = (): Pool => {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      idleTimeoutMillis: Number(process.env.PG_POOL_IDLE_MS ?? 30_000),
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 5_000)
    });
  }
  return pool;
};

const retryableCodes = new Set(['40001', '40P01', '53300', '57P01', '57P02', '57P03']);

const isRetryableError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string };
  if (e.code && retryableCodes.has(e.code)) return true;
  return /timeout|timed out|ECONNRESET|ENOTFOUND|connection/i.test(e.message ?? '');
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const queryWithClient = async <T extends QueryResultRow>(
  client: PoolClient,
  sql: string,
  params: unknown[] = []
): Promise<T[]> => {
  const timeoutMs = Number(process.env.PG_QUERY_TIMEOUT_MS ?? 8_000);
  const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 8_000;
  await client.query(`SET LOCAL statement_timeout = ${safeTimeoutMs};`);
  const result = await client.query<T>(sql, params);
  return result.rows;
};

export const queryPg = async <T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  options?: { retryClass?: 'read' | 'write' }
): Promise<T[]> => {
  const retryClass = options?.retryClass ?? 'read';
  const maxAttempts = retryClass === 'write' ? 4 : 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const client = await getPool().connect();
    try {
      const rows = await queryWithClient<T>(client, sql, params);
      client.release();
      return rows;
    } catch (error) {
      client.release();
      const shouldRetry = attempt < maxAttempts && isRetryableError(error);
      if (!shouldRetry) throw error;
      await sleep(attempt * 150);
    }
  }

  return [];
};

export const txPg = async <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const closePgPool = async () => {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
};

export const pgPoolHealth = async () => {
  const rows = await queryPg<{ ok: number }>('SELECT 1::int AS ok;', []);
  return rows[0]?.ok === 1;
};
