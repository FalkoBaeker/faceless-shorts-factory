import { createRequire } from 'node:module';
import { getPersistenceBackend, getPersistenceRuntimeMode } from './backend.ts';

export type DriverDecision = {
  backend: 'memory' | 'postgres';
  mode: 'memory' | 'stub-memory' | 'sql';
  externalDriverInstalled: boolean;
  approvalRequired: boolean;
  decision: 'STAY_STUB' | 'ENABLE_SQL';
  reason: string;
};

const hasPgDriverInstalled = (): boolean => {
  const require = createRequire(import.meta.url);
  try {
    require.resolve('pg');
    return true;
  } catch {
    return false;
  }
};

export const getDriverDecision = (): DriverDecision => {
  const backend = getPersistenceBackend();
  const mode = getPersistenceRuntimeMode();
  const envEnabled = process.env.POSTGRES_DRIVER_AVAILABLE === 'true';
  const pgInstalled = hasPgDriverInstalled();
  const externalDriverInstalled = envEnabled && pgInstalled;

  if (backend === 'memory') {
    return {
      backend,
      mode,
      externalDriverInstalled,
      approvalRequired: false,
      decision: 'STAY_STUB',
      reason: 'Memory backend selected; SQL driver not required.'
    };
  }

  if (!externalDriverInstalled) {
    return {
      backend,
      mode,
      externalDriverInstalled,
      approvalRequired: true,
      decision: 'STAY_STUB',
      reason: envEnabled
        ? 'POSTGRES_DRIVER_AVAILABLE=true, but pg package is missing in runtime.'
        : 'No pg driver installed/approved in current environment.'
    };
  }

  return {
    backend,
    mode,
    externalDriverInstalled,
    approvalRequired: false,
    decision: 'ENABLE_SQL',
    reason: 'Driver is present and backend is postgres.'
  };
};
