const notImplemented = (operation: string): never => {
  throw new Error(`POSTGRES_SKELETON_NOT_IMPLEMENTED:${operation}`);
};

export const postgresSkeleton = {
  createProject: () => notImplemented('createProject'),
  getProject: () => notImplemented('getProject'),
  listProjects: () => notImplemented('listProjects'),
  setProjectStatus: () => notImplemented('setProjectStatus'),

  saveJob: () => notImplemented('saveJob'),
  getJob: () => notImplemented('getJob'),
  listJobs: () => notImplemented('listJobs'),
  appendTimelineEvent: () => notImplemented('appendTimelineEvent'),

  reserveCredit: () => notImplemented('reserveCredit'),
  commitCredit: () => notImplemented('commitCredit'),
  releaseCredit: () => notImplemented('releaseCredit'),
  listLedger: () => notImplemented('listLedger'),

  publishNow: () => notImplemented('publishNow'),
  listPublishPosts: () => notImplemented('listPublishPosts'),
  getPublishedJobsCount: () => notImplemented('getPublishedJobsCount')
};
