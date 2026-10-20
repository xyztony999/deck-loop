import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Jest globalSetup：整轮测试只启动一次 mongodb-memory-server **副本集**。
 *
 * 为什么是副本集（ReplicaSet）而非单机（standalone）：
 * 业务代码大量使用 mongoose `connection.transaction`（version 留档单事务
 * seq 分配+insertOnly+movePointer+引用计数、deck/GT/EX 取号、asset brandkit
 * 默认切换）。MongoDB 多文档事务仅在副本集（或分片集群）上可用——单机模式
 * 下首次开启事务即抛 "Transaction numbers are only allowed on a replica
 * set or as part of a sharded transaction"。
 *
 * - 单节点副本集（count=1, wiredTiger）即满足事务要求，开销最低；
 * - URI 写入 process.env.MONGODB_URI：globalSetup 在主进程先于 worker 执行，
 *   env 变更被测试 worker 继承（AppModule forRoot 直读即得内存库地址，
 *   URI 自带 replicaSet 参数）；
 * - 同时镜像到 globalThis.__MONGO_URI__ / __MONGO_REPLSET__ 供 globalTeardown
 *   停机（首次运行可能触发 mongod 二进制下载，已有 7.x 缓存则秒起）。
 */
export default async function globalSetup(): Promise<void> {
  const replSet = await MongoMemoryReplSet.create({
    instanceOpts: [{ storageEngine: 'wiredTiger' }],
    replSet: { count: 1, name: 'dlrs' },
  });
  const uri = replSet.getUri('deck_loop');

  (globalThis as { __MONGO_URI__?: string }).__MONGO_URI__ = uri;
  (globalThis as { __MONGO_REPLSET__?: MongoMemoryReplSet }).__MONGO_REPLSET__ = replSet;
  process.env.MONGODB_URI = uri;
}
