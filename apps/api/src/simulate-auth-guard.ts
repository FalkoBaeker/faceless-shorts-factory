import type { Server } from 'node:http';
import { startApiServer } from './server.ts';

const closeServer = async (server: Server) => {
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };

    server.close(() => finish());
    setTimeout(() => finish(), 2_000).unref();
  });
};

const run = async () => {
  const previous = process.env.AUTH_REQUIRED;
  process.env.AUTH_REQUIRED = 'true';

  const { server, port } = await startApiServer(0);
  const base = `http://127.0.0.1:${port}`;
  let exitCode = 0;

  try {
    const res = await fetch(`${base}/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId: 'org_guard_probe',
        topic: 'guard probe',
        language: 'de',
        voice: 'de_female_01',
        variantType: 'SHORT_15'
      })
    });

    const body = await res.json();

    console.log(
      JSON.stringify(
        {
          ok: res.status === 401,
          status: res.status,
          error: body.error ?? null
        },
        null,
        2
      )
    );

    if (res.status !== 401) {
      exitCode = 1;
    }
  } finally {
    await closeServer(server);
    if (previous === undefined) {
      delete process.env.AUTH_REQUIRED;
    } else {
      process.env.AUTH_REQUIRED = previous;
    }
  }

  process.exit(exitCode);
};

run().catch((error) => {
  console.error(`AUTH_GUARD_SMOKE_FAILED:${String((error as Error)?.message ?? error)}`);
  process.exit(1);
});
