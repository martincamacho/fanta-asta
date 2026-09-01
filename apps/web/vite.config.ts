/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Backend configurable para e2e (FANTA_SERVER_PORT); default el server de dev en :3001.
const serverTarget = `http://localhost:${process.env.FANTA_SERVER_PORT ?? 3001}`;
const proxy = {
  '/api': serverTarget,
  '/campioncini': serverTarget,
  '/socket.io': {
    target: serverTarget,
    ws: true,
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy,
  },
  preview: {
    proxy,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
