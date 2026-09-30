import { buildApp } from './app';
import { config } from './config';

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error('api failed to start:', err);
  process.exit(1);
});
