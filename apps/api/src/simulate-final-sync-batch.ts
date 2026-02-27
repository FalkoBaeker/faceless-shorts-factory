import { planFinalSync, resolveCaptionSafeArea } from './providers/live-provider-runtime.ts';

const topics = [
  'Sommerangebot für lokale Bäckerei in Berlin',
  'Autowerkstatt Wintercheck inkl. Bremsen',
  'Friseursalon Last-Minute Termine',
  'Yoga-Studio Intro-Angebot für Anfänger',
  'Zahnarztpraxis Prophylaxe Kampagne',
  'Umzugsservice kurzfristig verfügbar',
  'Café Brunch am Wochenende',
  'Physiotherapie Rückenfit Programm'
];

const targetDurations = [30, 60];
const multipliers = [0.88, 0.93, 0.97, 1.0, 1.03, 1.06, 1.09];

type CaseResult = {
  topic: string;
  targetSeconds: number;
  sourceAudioSeconds: number;
  finalDurationSeconds: number;
  mode: string;
  tempo: number;
  driftToTarget: number;
  withinTolerance: boolean;
  sentencePreserved: boolean;
};

const run = async () => {
  const cases: CaseResult[] = [];

  for (const targetSeconds of targetDurations) {
    for (const topic of topics) {
      for (const multiplier of multipliers) {
        const sourceAudioSeconds = Number((targetSeconds * multiplier).toFixed(3));
        const plan = planFinalSync({ targetSeconds, sourceAudioSeconds });
        const driftToTarget = Number(Math.abs(plan.finalDurationSeconds - targetSeconds).toFixed(3));

        cases.push({
          topic,
          targetSeconds,
          sourceAudioSeconds,
          finalDurationSeconds: plan.finalDurationSeconds,
          mode: plan.mode,
          tempo: plan.tempo,
          driftToTarget,
          withinTolerance: driftToTarget <= plan.toleranceSeconds,
          sentencePreserved: plan.mode !== 'time_stretch_trim'
        });
      }
    }
  }

  const total = cases.length;
  const withinToleranceCount = cases.filter((entry) => entry.withinTolerance).length;
  const sentencePreservedCount = cases.filter((entry) => entry.sentencePreserved).length;

  const withinToleranceRate = withinToleranceCount / total;
  const sentencePreservedRate = sentencePreservedCount / total;

  const trimEdgeCase = planFinalSync({ targetSeconds: 30, sourceAudioSeconds: 38.5 });
  if (trimEdgeCase.mode !== 'time_stretch_trim') {
    throw new Error(`Expected trim edge case mode=time_stretch_trim, got ${trimEdgeCase.mode}`);
  }

  const safeArea = resolveCaptionSafeArea();
  const safeAreaValid =
    safeArea.safeWidth <= safeArea.frameWidth &&
    safeArea.safeHeight <= safeArea.frameHeight &&
    safeArea.marginX >= 0 &&
    safeArea.marginY >= 0;

  if (!safeAreaValid) {
    throw new Error(`Safe area invalid: ${JSON.stringify(safeArea)}`);
  }

  const summary = {
    check: 'FINAL_SYNC_BATCH_VERIFY',
    total,
    withinToleranceCount,
    withinToleranceRate: Number((withinToleranceRate * 100).toFixed(2)),
    sentencePreservedCount,
    sentencePreservedRate: Number((sentencePreservedRate * 100).toFixed(2)),
    toleranceTargetPercent: 95,
    preserveSentenceTargetPercent: 95,
    trimEdgeCase,
    safeArea,
    sample: cases.slice(0, 6)
  };

  if (withinToleranceRate < 0.95) {
    throw new Error(`FINAL_SYNC tolerance below 95%: ${(withinToleranceRate * 100).toFixed(2)}%`);
  }

  if (sentencePreservedRate < 0.95) {
    throw new Error(`FINAL_SYNC sentence-preserve below 95%: ${(sentencePreservedRate * 100).toFixed(2)}%`);
  }

  console.log(JSON.stringify(summary, null, 2));
};

run().catch((error) => {
  console.error(JSON.stringify({ check: 'FINAL_SYNC_BATCH_VERIFY', ok: false, error: String(error?.message ?? error) }, null, 2));
  process.exit(1);
});
