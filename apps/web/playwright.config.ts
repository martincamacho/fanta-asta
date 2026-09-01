import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

/** e2e contra el server REAL: server en :3101 con DB temporal + build de la web
 *  servido por `vite preview` en :4173 (proxy /api, /campioncini y /socket.io → :3101). */
const SERVER_PORT = 3101;
const WEB_PORT = 4173;
const DB_PATH = path.join(os.tmpdir(), `fanta-e2e-${Date.now()}.sqlite`);

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
  },
  webServer: [
    {
      command: 'pnpm --dir ../server start',
      url: `http://localhost:${SERVER_PORT}/api/players`,
      reuseExistingServer: false,
      timeout: 90_000,
      env: {
        PORT: String(SERVER_PORT),
        DB_PATH,
      },
    },
    {
      command: `pnpm build && pnpm preview --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        FANTA_SERVER_PORT: String(SERVER_PORT),
      },
    },
  ],
});
