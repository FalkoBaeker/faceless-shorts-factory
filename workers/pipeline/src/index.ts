export const queueNames = {
  ideation: 'video.ideation',
  storyboard: 'video.storyboard',
  video: 'video.segment.render',
  audio: 'video.audio.tts',
  assembly: 'video.assembly',
  publish: 'video.publish'
} as const;

export const defaultRetryPolicy = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delayMs: 2000
  }
} as const;

export * from './state-machine';
export * from './runner';
export * from './run-plan';
export * from './orchestrator';
