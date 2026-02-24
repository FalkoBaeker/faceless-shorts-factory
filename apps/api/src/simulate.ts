import {
  createProjectHandler,
  selectConceptHandler,
  generateHandler,
  getJobHandler
} from './handlers.ts';

const project = createProjectHandler({
  organizationId: 'org_demo',
  topic: 'Rohr verstopft',
  language: 'de',
  voice: 'de_female_01',
  variantType: 'SHORT_15'
});

const selection = selectConceptHandler({
  projectId: project.projectId,
  conceptId: 'concept_1',
  variantType: 'SHORT_15'
});

const done = generateHandler(selection.jobId);
const fetched = getJobHandler(selection.jobId);

console.log(
  JSON.stringify(
    {
      project,
      selection,
      finalStatus: done.status,
      timelineLength: done.timeline.length,
      fetchedStatus: fetched.status
    },
    null,
    2
  )
);
