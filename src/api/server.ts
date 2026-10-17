import { buildApp } from './app.js';

export const HOST = '127.0.0.1';
export const PORT = 3001;

const app = buildApp({ logger: true });
app.listen({ host: HOST, port: PORT }).catch((e: unknown) => {
  app.log.error(e);
  process.exitCode = 1;
});
