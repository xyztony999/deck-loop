import type { MongoMemoryReplSet } from 'mongodb-memory-server';

/** Jest globalTeardown：停掉 globalSetup 启动的共享副本集 */
export default async function globalTeardown(): Promise<void> {
  const replSet = (globalThis as { __MONGO_REPLSET__?: MongoMemoryReplSet }).__MONGO_REPLSET__;
  if (replSet) {
    await replSet.stop();
  }
}
