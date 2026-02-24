export const sqlProjectRepo = {
  createSql: 'INSERT INTO projects (id, organization_id, topic, language, voice, variant_type, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *;',
  getByIdSql: 'SELECT * FROM projects WHERE id = $1 LIMIT 1;'
};
