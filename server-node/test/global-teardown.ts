/**
 * Jest globalTeardown（ADR-016）：pg-mem 数据源随 TestContext.close() 销毁，
 * 无全局共享实例需停机。保留为空操作。
 */
export default async function globalTeardown(): Promise<void> {
  // no-op
}
