import { createProjectHandler } from './handlers.ts';

try {
  createProjectHandler({
    organizationId: 'org_pg',
    topic: 'postgres skeleton',
    language: 'de',
    voice: 'de_female_01',
    variantType: 'SHORT_15'
  });
  console.log(JSON.stringify({ ok: false, reason: 'expected postgres skeleton error' }));
  process.exit(1);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.startsWith('POSTGRES_SKELETON_NOT_IMPLEMENTED:')) {
    throw error;
  }
  console.log(JSON.stringify({ ok: true, message }, null, 2));
}
