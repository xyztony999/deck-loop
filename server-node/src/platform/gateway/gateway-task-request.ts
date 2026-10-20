/**
 * 网关任务提交请求（进程内值对象，api-generation §4.3「submitToGateway(task)」入参，
 * manifest §10：GatewayTaskService#execute(task)）。
 *
 * 由 generation/adjustment 域任务创建后组装并调用 GatewayTaskService#execute；
 * 路由快照（channelCode/modelCode）已由调用方按渠道偏好解析填充，网关不重复路由。
 * v1 GatewayTaskRequest 字段平移；userId 为隔离字段（服务端上下文组装，ADR-005）。
 */
export class GatewayTaskRequest {
  /** 任务 ID（dl_generation_task.task_id，provider 调用幂等键） */
  taskId!: string;

  /** 归属创作物 */
  deckId!: string;

  /** 任务类型：TaskType（OUTLINE/FULL_GENERATE/FULL_ADJUST/TARGETED_ADJUST） */
  taskType!: string;

  /** 属主（隔离字段，ADR-005） */
  userId!: string;

  /** 路由快照：渠道编码 */
  channelCode!: string;

  /** 路由快照：模型编码 */
  modelCode!: string;

  /** 指令快照 JSON（入参/指令/scope/brandKitId/assetIds/usedTemplateIds/lengthOption） */
  instructionSnapshot!: string;
}
