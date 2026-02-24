export const sqlTemplates = {
  projects: {
    insert:
      'INSERT INTO projects (id, organization_id, topic, language, voice, variant_type, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *;',
    getById: 'SELECT * FROM projects WHERE id = $1 LIMIT 1;',
    listByOrg: 'SELECT * FROM projects WHERE organization_id = $1 ORDER BY created_at DESC;',
    setStatus: 'UPDATE projects SET status = $2 WHERE id = $1 RETURNING *;'
  },
  jobs: {
    upsert:
      'INSERT INTO jobs (id, project_id, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at RETURNING *;',
    getById: 'SELECT * FROM jobs WHERE id = $1 LIMIT 1;',
    list: 'SELECT * FROM jobs ORDER BY updated_at DESC;'
  },
  jobEvents: {
    insert: 'INSERT INTO job_events (job_id, at, event, detail) VALUES ($1,$2,$3,$4) RETURNING *;',
    listByJob: 'SELECT * FROM job_events WHERE job_id = $1 ORDER BY at ASC;'
  },
  creditLedger: {
    insert: 'INSERT INTO credit_ledger (id, organization_id, job_id, amount, type, note, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *;',
    listByOrg: 'SELECT * FROM credit_ledger WHERE organization_id = $1 ORDER BY created_at ASC;',
    listAll: 'SELECT * FROM credit_ledger ORDER BY created_at ASC;'
  },
  publishPosts: {
    insert:
      'INSERT INTO publish_posts (job_id, target, post_url, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (job_id, target) DO UPDATE SET post_url = EXCLUDED.post_url RETURNING *;',
    listByJob: 'SELECT * FROM publish_posts WHERE job_id = $1 ORDER BY created_at ASC;',
    countJobs: 'SELECT COUNT(DISTINCT job_id)::int AS count FROM publish_posts;'
  }
} as const;
