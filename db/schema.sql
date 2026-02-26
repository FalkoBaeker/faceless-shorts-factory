CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  region text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  topic text NOT NULL,
  language text NOT NULL,
  voice text NOT NULL,
  variant_type text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_events (
  id bigserial PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id),
  at timestamptz NOT NULL,
  event text NOT NULL,
  detail text
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  job_id text REFERENCES jobs(id),
  amount integer NOT NULL,
  type text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS publish_posts (
  id bigserial PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id),
  target text NOT NULL,
  post_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, target)
);

CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_events_job ON job_events(job_id, at);
CREATE INDEX IF NOT EXISTS idx_ledger_org ON credit_ledger(organization_id, created_at);

CREATE TABLE IF NOT EXISTS app_users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'free',
  subscription_status text NOT NULL DEFAULT 'inactive',
  credits_remaining integer,
  monthly_job_limit integer,
  jobs_used integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_users_plan ON app_users(plan);
CREATE INDEX IF NOT EXISTS idx_app_users_subscription ON app_users(subscription_status);
