import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: { '/reconcile': `http://127.0.0.1:${process.env.API_PORT ?? 3001}` },
    // The GUI imports shared code from ../src.
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
  },
});
