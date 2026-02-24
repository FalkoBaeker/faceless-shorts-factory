import { sqlTemplates } from './sql-templates.ts';

export const sqlProjectRepo = {
  createSql: sqlTemplates.projects.insert,
  getByIdSql: sqlTemplates.projects.getById,
  listByOrgSql: sqlTemplates.projects.listByOrg,
  setStatusSql: sqlTemplates.projects.setStatus
};
