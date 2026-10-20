import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Result } from '../common/result';
import { FullGenerateAO, GenerationTaskSubmitVO, OutlineGenerateAO, OutlineSaveAO } from './generation.dto';
import { GenerationTaskService } from './generation.service';

/**
 * 初稿生成发起接口（POST /gen/outline/*、/gen/full/*，api-generation §4.4 接口清单 1-3；
 * v1 GenerationOutlineController/GenerationFullGenerateController 对齐）。
 *
 * 个人单用户产品不建 RBAC（api-generation §3.3）：无权限注解，全部接口=登录会话
 * + user_id 属主隔离（@CurrentUser 服务端注入，NR-05；Service/Repository 强制）。
 * HTTP 状态恒 200（v1 对齐：@HttpCode(OK)，异常经全局 Filter 转 Result）。
 */
@Controller('gen/outline')
export class GenerationOutlineController {
  constructor(private readonly taskService: GenerationTaskService) {}

  /** 1. 发起大纲生成（OUTLINE）：→taskId/taskCode/taskStatus */
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generate(
    @Body() ao: OutlineGenerateAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<GenerationTaskSubmitVO>> {
    return Result.success(await this.taskService.outlineGenerate(ao, userId));
  }

  /** 2. 保存大纲编辑：持久化 Deck.draftOutline（节点 1~50、title ≤50） */
  @Post('save')
  @HttpCode(HttpStatus.OK)
  async save(
    @Body() ao: OutlineSaveAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<null>> {
    await this.taskService.outlineSave(ao, userId);
    return Result.success();
  }
}

@Controller('gen/full')
export class GenerationFullController {
  constructor(private readonly taskService: GenerationTaskService) {}

  /** 3. 发起整稿生成（FULL_GENERATE）：outlineSnapshot 或 useDraft=true；→taskId */
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generate(
    @Body() ao: FullGenerateAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<GenerationTaskSubmitVO>> {
    return Result.success(await this.taskService.fullGenerate(ao, userId));
  }
}
