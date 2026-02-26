import { loadEnvFiles } from './config/env-loader.ts';
import { sendAlert } from './services/alert-service.ts';

loadEnvFiles();

const run = async () => {
  const warn = await sendAlert({
    severity: 'warn',
    subject: '[faceless-shorts-factory] test alert',
    message: 'manual smoke warning alert'
  });

  const info = await sendAlert({
    severity: 'info',
    subject: '[faceless-shorts-factory] info trace',
    message: 'info should route to logs in MVP policy'
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        warn,
        info
      },
      null,
      2
    )
  );
};

run().catch((error) => {
  console.error(`ALERT_SMOKE_FAILED:${String((error as Error)?.message ?? error)}`);
  process.exit(1);
});
