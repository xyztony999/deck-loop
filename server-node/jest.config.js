/**
 * Jest 配置：
 * - mongodb-memory-server 全局起一次（globalSetup），URI 经 process.env.MONGODB_URI
 *   继承给 worker（globalSetup 在主进程先于 worker 执行，env 变更会被继承），
 *   并镜像到 global.__MONGO_URI__ 供 globalTeardown/调试使用
 * - --runInBand（package.json test 脚本）：单进程串行，共享同一实例
 * - testMatch *.spec.ts：域内测试与 src 同置或放 test/ 均可
 */
/** @type {import('jest').Config} */
module.exports = {
  watchman: false,
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  globalSetup: '<rootDir>/test/global-setup.ts',
  globalTeardown: '<rootDir>/test/global-teardown.ts',
  testTimeout: 120000,
  clearMocks: true,
};
