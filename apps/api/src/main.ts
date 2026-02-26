import { loadEnvFiles } from './config/env-loader.ts';
import { startApiServer } from './server.ts';

loadEnvFiles();

const rawPort = Number(process.env.PORT ?? 3001);
const port = Number.isFinite(rawPort) && rawPort > 0 ? Math.floor(rawPort) : 3001;

const boot = async () => {
  const { port: actualPort } = await startApiServer(port);
  console.log(JSON.stringify({ event: 'api_server_started', port: actualPort }));
};

boot().catch((error) => {
  console.error(
    JSON.stringify({
      event: 'api_server_boot_failed',
      detail: String((error as Error)?.message ?? error)
    })
  );
  process.exit(1);
});
