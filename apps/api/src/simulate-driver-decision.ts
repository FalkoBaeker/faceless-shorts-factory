import { getDriverDecision } from './persistence/driver-decision.ts';

const decision = getDriverDecision();

console.log(
  JSON.stringify(
    {
      ok:
        decision.backend === 'postgres'
          ? decision.decision === 'STAY_STUB' || decision.decision === 'ENABLE_SQL'
          : decision.decision === 'STAY_STUB',
      ...decision
    },
    null,
    2
  )
);
