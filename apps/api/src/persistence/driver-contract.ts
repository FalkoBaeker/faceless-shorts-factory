export type SqlQueryResult<T = unknown> = { rows: T[] };

export type SqlExecutor = {
  query: <T = unknown>(sql: string, params?: unknown[]) => SqlQueryResult<T>;
};
