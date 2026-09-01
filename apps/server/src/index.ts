import { createServer } from './server.js';

const PORT = Number(process.env.PORT ?? 3001);

const { app, players } = await createServer({ logger: true });

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`Fanta-Asta server escuchando en :${PORT} — listone: ${players.length} jugadores`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().finally(() => process.exit(0));
  });
}
