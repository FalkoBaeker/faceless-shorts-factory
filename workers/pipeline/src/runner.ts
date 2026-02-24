import { isTransitionAllowed, type VideoJobStatus } from './state-machine.ts';

export const tryTransition = (from: VideoJobStatus, to: VideoJobStatus) => {
  return {
    from,
    to,
    allowed: isTransitionAllowed(from, to)
  };
};
