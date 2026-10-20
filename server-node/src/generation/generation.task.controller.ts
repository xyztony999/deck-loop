import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PageResult, Result } from '../common/result';
import {
  GenerationTaskCancelAO,
  GenerationTaskDetailAO,
  GenerationTaskDetailVO,
  GenerationTaskListAO,
  GenerationTaskListVO,
  GenerationTaskProgressAO,
  GenerationTaskProgressVO,
  GenerationTaskRetryAO,
  GenerationTaskSubmitVO,
} from './generation.dto';
import { GenerationTaskService } from './generation.service';

/**
 * 生成任务管理接口（POST /gen/task/*，api-generation §4.4 接口清单 4-8；
 * v1 GenerationTaskController 对齐；进度 SSE 归 platform GET /gw/task/stream，
 * 本域不建 /gen/task/stream）。
 *
 * 会话+属主（api-generation §3.3）：@CurrentUser 服务端注入 userId（NR-05），
 * Service/Repository 强制隔离。HTTP 状态恒 200（v1 对齐）。
 */
@Controller('gen/task')
export class GenerationTaskController {
  constructor(private readonly taskService: GenerationTaskService) {}

  /** 4. 任务列表：分页/按 deck/状态/类型筛；行含 deckName/instructionBrief 冗余与 operList */
  @Post('list')
  @HttpCode(HttpStatus.OK)
  async list(
    @Body() ao: GenerationTaskListAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<PageResult<GenerationTaskListVO>>> {
    return Result.success(await this.taskService.listPage(ao, userId));
  }

  /** 5. 任务详情：含指令快照/基线版本/用量计量 */
  @Post('detail')
  @HttpCode(HttpStatus.OK)
  async detail(
    @Body() ao: GenerationTaskDetailAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<GenerationTaskDetailVO>> {
    return Result.success(await this.taskService.detail(ao, userId));
  }

  /** 6. 任务进度批量查询：taskIds ≤20（客户端 2s 间隔轮询；progress 为派生展示数据） */
  @Post('progress')
  @HttpCode(HttpStatus.OK)
  async progress(
    @Body() ao: GenerationTaskProgressAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<GenerationTaskProgressVO[]>> {
    return Result.success(await this.taskService.progress(ao, userId));
  }

  /** 7. 取消任务：仅 QUEUED/RUNNING（否则 BIZ_TASK_NOT_CANCELLABLE） */
  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Body() ao: GenerationTaskCancelAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<null>> {
    await this.taskService.cancel(ao, userId);
    return Result.success();
  }

  /** 8. 重试任务：仅 FAILED；新任务复制 instruction_snapshot（同入参新实例） */
  @Post('retry')
  @HttpCode(HttpStatus.OK)
  async retry(
    @Body() ao: GenerationTaskRetryAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<GenerationTaskSubmitVO>> {
    return Result.success(await this.taskService.retry(ao, userId));
  }
}
