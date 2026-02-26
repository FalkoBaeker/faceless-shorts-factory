import { getPersistenceBackend } from '../persistence/backend.ts';
import { queryPg } from '../persistence/pg-pool.ts';
import { logEvent } from '../utils/app-logger.ts';

export type Plan = 'free' | 'beta' | 'pro';
export type SubscriptionStatus = 'inactive' | 'trialing' | 'active' | 'canceled';

export type AuthIdentity = {
  id: string;
  email: string;
  appMetadata?: Record<string, unknown>;
  userMetadata?: Record<string, unknown>;
};

export type EntitlementRecord = {
  userId: string;
  email: string;
  plan: Plan;
  subscriptionStatus: SubscriptionStatus;
  creditsRemaining: number | null;
  monthlyJobLimit: number | null;
  jobsUsed: number;
  allowlisted: boolean;
  source: 'memory' | 'postgres';
};

export type EntitlementDecision = {
  allow: boolean;
  reason:
    | 'ALLOWLIST'
    | 'PLAN_ENTITLED'
    | 'SUBSCRIPTION_ACTIVE'
    | 'PLAN_FREE_NOT_ALLOWED'
    | 'FEATURE_DISABLED_MVP'
    | 'CREDITS_EXHAUSTED'
    | 'MONTHLY_LIMIT_REACHED';
  record: EntitlementRecord;
};

type Feature = 'run_job' | 'publish';

type EntitlementRow = {
  id: string;
  email: string;
  plan: Plan;
  subscription_status: SubscriptionStatus;
  credits_remaining: number | null;
  monthly_job_limit: number | null;
  jobs_used: number;
};

const memoryUsers = new Map<string, EntitlementRecord>();
let schemaReady = false;

const asLower = (value: string) => value.trim().toLowerCase();

const normalizePlan = (value: unknown): Plan => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'beta' || raw === 'pro') return raw;
  return 'free';
};

const normalizeSubscription = (value: unknown): SubscriptionStatus => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'trialing' || raw === 'active' || raw === 'canceled') return raw;
  return 'inactive';
};

const parseOptionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : null;
};

const parseAllowlist = () => {
  const raw = process.env.ADMIN_ALLOWLIST ?? '';
  return new Set(
    raw
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map(asLower)
  );
};

const isAllowlisted = (identity: AuthIdentity) => {
  const allowlist = parseAllowlist();
  return allowlist.has(asLower(identity.id)) || allowlist.has(asLower(identity.email));
};

const metadataValue = (identity: AuthIdentity, key: string): unknown => {
  if (identity.appMetadata && key in identity.appMetadata) return identity.appMetadata[key];
  if (identity.userMetadata && key in identity.userMetadata) return identity.userMetadata[key];
  return undefined;
};

const ensureSchema = async () => {
  if (schemaReady || getPersistenceBackend() !== 'postgres') return;

  try {
    await queryPg(
      `CREATE TABLE IF NOT EXISTS app_users (
        id text PRIMARY KEY,
        email text NOT NULL UNIQUE,
        plan text NOT NULL DEFAULT 'free',
        subscription_status text NOT NULL DEFAULT 'inactive',
        credits_remaining integer,
        monthly_job_limit integer,
        jobs_used integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      );`,
      [],
      { retryClass: 'write' }
    );

    await queryPg(
      `CREATE INDEX IF NOT EXISTS idx_app_users_plan ON app_users(plan);
       CREATE INDEX IF NOT EXISTS idx_app_users_subscription_status ON app_users(subscription_status);`,
      [],
      { retryClass: 'write' }
    );

    schemaReady = true;
  } catch (error) {
    logEvent({
      event: 'entitlement_schema_warning',
      level: 'WARN',
      detail: String((error as Error)?.message ?? error)
    });
  }
};

const loadPgRecord = async (userId: string): Promise<EntitlementRow | null> => {
  await ensureSchema();
  const rows = await queryPg<EntitlementRow>(
    `SELECT id, email, plan, subscription_status, credits_remaining, monthly_job_limit, jobs_used
       FROM app_users
      WHERE id = $1
      LIMIT 1;`,
    [userId]
  );
  return rows[0] ?? null;
};

const mapRow = (row: EntitlementRow, allowlisted: boolean): EntitlementRecord => ({
  userId: row.id,
  email: row.email,
  plan: normalizePlan(row.plan),
  subscriptionStatus: normalizeSubscription(row.subscription_status),
  creditsRemaining: parseOptionalNumber(row.credits_remaining),
  monthlyJobLimit: parseOptionalNumber(row.monthly_job_limit),
  jobsUsed: Number.isFinite(Number(row.jobs_used)) ? Number(row.jobs_used) : 0,
  allowlisted,
  source: 'postgres'
});

const upsertPgRecord = async (input: EntitlementRecord): Promise<EntitlementRecord> => {
  await ensureSchema();

  const rows = await queryPg<EntitlementRow>(
    `INSERT INTO app_users (
        id,
        email,
        plan,
        subscription_status,
        credits_remaining,
        monthly_job_limit,
        jobs_used,
        updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,now())
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        plan = EXCLUDED.plan,
        subscription_status = EXCLUDED.subscription_status,
        credits_remaining = COALESCE(EXCLUDED.credits_remaining, app_users.credits_remaining),
        monthly_job_limit = COALESCE(EXCLUDED.monthly_job_limit, app_users.monthly_job_limit),
        jobs_used = COALESCE(EXCLUDED.jobs_used, app_users.jobs_used),
        updated_at = now()
      RETURNING id, email, plan, subscription_status, credits_remaining, monthly_job_limit, jobs_used;`,
    [
      input.userId,
      input.email,
      input.plan,
      input.subscriptionStatus,
      input.creditsRemaining,
      input.monthlyJobLimit,
      input.jobsUsed
    ],
    { retryClass: 'write' }
  );

  const row = rows[0];
  if (!row) return input;
  return mapRow(row, input.allowlisted);
};

const buildCandidateRecord = (identity: AuthIdentity, existing: EntitlementRecord | null): EntitlementRecord => {
  const allowlisted = isAllowlisted(identity);
  const plan = normalizePlan(metadataValue(identity, 'plan') ?? existing?.plan ?? 'free');
  const subscriptionStatus = normalizeSubscription(
    metadataValue(identity, 'subscription_status') ?? metadataValue(identity, 'subscriptionStatus') ?? existing?.subscriptionStatus
  );

  const creditsRemaining =
    parseOptionalNumber(metadataValue(identity, 'credits_remaining')) ??
    parseOptionalNumber(metadataValue(identity, 'credits')) ??
    existing?.creditsRemaining ??
    null;

  const monthlyJobLimit =
    parseOptionalNumber(metadataValue(identity, 'monthly_job_limit')) ??
    parseOptionalNumber(metadataValue(identity, 'job_limit')) ??
    existing?.monthlyJobLimit ??
    null;

  const jobsUsed = existing?.jobsUsed ?? 0;

  return {
    userId: identity.id,
    email: identity.email,
    plan,
    subscriptionStatus,
    creditsRemaining,
    monthlyJobLimit,
    jobsUsed,
    allowlisted,
    source: getPersistenceBackend() === 'postgres' ? 'postgres' : 'memory'
  };
};

const upsertMemoryRecord = (record: EntitlementRecord): EntitlementRecord => {
  memoryUsers.set(record.userId, record);
  return record;
};

export const syncEntitlementRecord = async (identity: AuthIdentity): Promise<EntitlementRecord> => {
  if (getPersistenceBackend() === 'postgres') {
    const existingRow = await loadPgRecord(identity.id);
    const existing = existingRow ? mapRow(existingRow, isAllowlisted(identity)) : null;
    const candidate = buildCandidateRecord(identity, existing);
    return upsertPgRecord(candidate);
  }

  const existing = memoryUsers.get(identity.id) ?? null;
  const candidate = buildCandidateRecord(identity, existing);
  return upsertMemoryRecord(candidate);
};

const mvpAutoPublishEnabled = () => process.env.ENABLE_AUTO_PUBLISH === 'true';

const hasPositiveCredits = (record: EntitlementRecord) => record.creditsRemaining === null || record.creditsRemaining > 0;

const hasCapacity = (record: EntitlementRecord) =>
  record.monthlyJobLimit === null || record.jobsUsed < record.monthlyJobLimit;

export const isEntitled = async (identity: AuthIdentity, feature: Feature): Promise<EntitlementDecision> => {
  const record = await syncEntitlementRecord(identity);

  if (feature === 'publish' && !mvpAutoPublishEnabled()) {
    return { allow: false, reason: 'FEATURE_DISABLED_MVP', record };
  }

  if (!hasPositiveCredits(record)) {
    return { allow: false, reason: 'CREDITS_EXHAUSTED', record };
  }

  if (!hasCapacity(record)) {
    return { allow: false, reason: 'MONTHLY_LIMIT_REACHED', record };
  }

  if (record.allowlisted) {
    return { allow: true, reason: 'ALLOWLIST', record };
  }

  if (record.plan === 'beta' || record.plan === 'pro') {
    return { allow: true, reason: 'PLAN_ENTITLED', record };
  }

  if (record.subscriptionStatus === 'active' || record.subscriptionStatus === 'trialing') {
    return { allow: true, reason: 'SUBSCRIPTION_ACTIVE', record };
  }

  return { allow: false, reason: 'PLAN_FREE_NOT_ALLOWED', record };
};

export const canRunJob = async (identity: AuthIdentity) => {
  return isEntitled(identity, 'run_job');
};

export const canPublish = async (identity: AuthIdentity) => {
  return isEntitled(identity, 'publish');
};

export const assertCanRunJob = async (identity: AuthIdentity) => {
  const decision = await canRunJob(identity);
  if (!decision.allow) {
    throw new Error(`NOT_ENTITLED:${decision.reason}`);
  }
  return decision;
};

const consumeInMemory = (record: EntitlementRecord): EntitlementRecord => {
  const nextCredits = record.creditsRemaining === null ? null : Math.max(0, record.creditsRemaining - 1);
  const updated: EntitlementRecord = {
    ...record,
    jobsUsed: record.jobsUsed + 1,
    creditsRemaining: nextCredits,
    source: 'memory'
  };
  memoryUsers.set(updated.userId, updated);
  return updated;
};

const consumeInPostgres = async (record: EntitlementRecord): Promise<EntitlementRecord> => {
  await ensureSchema();

  const rows = await queryPg<EntitlementRow>(
    `UPDATE app_users
        SET jobs_used = jobs_used + 1,
            credits_remaining = CASE
              WHEN credits_remaining IS NULL THEN NULL
              WHEN credits_remaining <= 0 THEN 0
              ELSE credits_remaining - 1
            END,
            updated_at = now()
      WHERE id = $1
      RETURNING id, email, plan, subscription_status, credits_remaining, monthly_job_limit, jobs_used;`,
    [record.userId],
    { retryClass: 'write' }
  );

  const row = rows[0];
  if (!row) return record;
  return mapRow(row, record.allowlisted);
};

export const registerJobConsumption = async (identity: AuthIdentity): Promise<EntitlementRecord> => {
  const synced = await syncEntitlementRecord(identity);
  if (getPersistenceBackend() === 'postgres') {
    return consumeInPostgres(synced);
  }

  return consumeInMemory(synced);
};

export const assertCanPublish = async (identity: AuthIdentity) => {
  const decision = await canPublish(identity);
  if (!decision.allow) {
    throw new Error(`NOT_ENTITLED:${decision.reason}`);
  }
  return decision;
};
