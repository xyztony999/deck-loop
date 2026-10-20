/**
 * 网关任务回调契约（api-generation §4.3「onTaskCallback(taskId, status, result, usage)」）。
 *
 * - 防腐接口 + 延迟绑定：**generation 域提供实现**（GenerationModule 内
 *   `{ provide: GATEWAY_TASK_CALLBACK, useClass: <impl> }`），platform 经
 *   ModuleRef 惰性解析（ObjectProvider 语义），未就绪/抛错时网关兜底推进 FAILED；
 * - 幂等键 = taskId + 期望前置状态（实现方以条件更新守卫，重复投递安全）；
 * - SUCCEEDED 的 result_version_id 落库与任务终态推进由回调方（generation 编排）完成，
 *   满足「SUCCEEDED ⇔ result_version_id 非空」不变量（api-generation §4.1）——
 *   网关不触碰 result_version_id，只回传产物 content。
 */
export interface GatewayTaskCallback {
  /**
   * provider 调用完成后的业务编排回调。
   *
   * @param taskId 任务 ID
   * @param status 目标终态：TaskStatus（SUCCEEDED/FAILED）
   * @param result 成功=产物 JSON（大纲/内容快照）；失败=错误描述（含 BIZ_GW_* 错误码）
   * @param usage 用量（tokens 已由网关回填任务表并入账 dl_usage_record）
   */
  onTaskCallback(taskId: string, status: string, result: string, usage: GatewayTaskUsage): Promise<void> | void;
}

/** 单次调用用量快照（v1 GatewayTaskCallback.Usage 平移） */
export interface GatewayTaskUsage {
  channelCode: string;
  modelCode: string;
  promptTokens: number;
  completionTokens: number;
}

/** DI token（跨模块字符串 token；generation 域 provide，platform 惰性消费） */
export const GATEWAY_TASK_CALLBACK = 'GATEWAY_TASK_CALLBACK';
