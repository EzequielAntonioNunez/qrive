import { createApp } from './app';
export { SessionRoom } from './room';
export { default as productionHandlers } from './index';

const app = createApp(true);
export default { fetch: app.fetch, async queue(batch: MessageBatch, env: import('./types').Env) {
  const { default: handlers } = await import('./index');
  await handlers.queue(batch as MessageBatch<import('./types').EventMessage>, env);
} };
