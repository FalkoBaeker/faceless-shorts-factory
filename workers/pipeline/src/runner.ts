import { isTransitionAllowed, type VideoJobStatus } from './state-machine';

export const tryTransition = (from: VideoJobStatus, to: VideoJobStatus) => {
  return {
    from,
    to,
    allowed: isTransitionAllowed(from, to)
  };
};
