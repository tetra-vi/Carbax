import { buildDeps, loadConfig } from './container';
import { createApp } from './http/app';
import { installFactorSets } from './application/factors';

async function main() {
  const config = loadConfig();
  const deps = buildDeps(config);
  const installed = await installFactorSets(deps);
  if (installed.length) console.log(JSON.stringify({ severity: 'INFO', message: 'factor sets installed', installed }));
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? config.publicAppUrl).split(',').map((s) => s.trim()).filter(Boolean);
  const app = createApp(deps, { allowedOrigins });
  const port = Number(process.env.PORT ?? 8080);
  app.listen(port, () => console.log(JSON.stringify({ severity: 'INFO', message: `ComplyBridge API listening on ${port}`, env: config.env })));
}

main().catch((e) => {
  console.error(JSON.stringify({ severity: 'CRITICAL', message: 'startup failed', error: (e as Error).message }));
  process.exit(1);
});
