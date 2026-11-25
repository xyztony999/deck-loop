/**
 * Jest 配置：SQLite in-memory 集成测试（无外部依赖）。
 * env-setup 先于一切 import 置 DECK_LOOP_DB=sqlite（entity 列类型常量口径）。
 */
/** @type {import('jest').Config} */
module.exports = {
  watchman: false,
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  setupFiles: ['<rootDir>/test/env-setup.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  testTimeout: 120000,
  clearMocks: true,
};