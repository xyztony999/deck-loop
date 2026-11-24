/**
 * Jest globalSetup（ADR-016：MongoDB → PostgreSQL）。
 *
 * 测试库改用 pg-mem 内存 PostgreSQL，且**每 TestContext 独立建库**
 * （见 test/helpers/testing-app.ts#createTestDataSource）——不再需要全局
 * 共享实例/URI 继承。本钩子保留为空操作（jest.config 仍引用），无副作用。
 */
export default async function globalSetup(): Promise<void> {
  // no-op：pg-mem 数据源在 TestContext.create() 内按需创建并覆盖 AppModule DataSource
}
