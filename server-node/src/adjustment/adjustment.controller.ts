import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Result } from '../common/result';
import { AdjustmentService } from './adjustment.service';
import {
  AdjustScopeValidateAO,
  AdjustScopeValidateVO,
  AdjustSubmitVO,
  TargetedAdjustSubmitAO,
  WholeAdjustSubmitAO,
} from './adjustment.dto';

/**
 * 调整指令接口（POST /adjust/whole|targeted|scope/*，api-adjustment §4.4
 * 接口清单 1-3；v1 AdjustWholeController/AdjustTargetedController/
 * AdjustScopeController 逐字对齐）。
 *
 * 个人单用户产品不建 RBAC（api-adjustment §3.3）：无权限注解，全部接口=登录会话
 * + deck/version 属主隔离（@CurrentUser 服务端注入 userId，NR-05；Service 层强制）。
 * HTTP 状态恒 200（@HttpCode(OK)，异常经全局 Filter 转 Result，跨域 BizException
 * 原样透传不吞并）。任务执行/列表/取消/重试复用 /gen/task/*
 * （taskType=FULL_ADJUST/TARGETED_ADJUST），本域不重复建端点。
 */
@Controller('adjust/whole')
export class AdjustmentWholeController {
  constructor(private readonly adjustmentService: AdjustmentService) {}

  /** 1. 整稿调整提交 → taskId/taskCode/taskStatus/forked（基线≠当前未确认时 needForkBranch 提示态） */
  @Post('submit')
  @HttpCode(HttpStatus.OK)
  async submit(
    @Body() ao: WholeAdjustSubmitAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<AdjustSubmitVO>> {
    return Result.success(await this.adjustmentService.wholeSubmit(ao, userId));
  }
}

@Controller('adjust/targeted')
export class AdjustmentTargetedController {
  constructor(private readonly adjustmentService: AdjustmentService) {}

  /** 2. 定向调整提交 → taskId/taskCode/taskStatus/forked；INV-9 等价 scope/validate 内联 */
  @Post('submit')
  @HttpCode(HttpStatus.OK)
  async submit(
    @Body() ao: TargetedAdjustSubmitAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<AdjustSubmitVO>> {
    return Result.success(await this.adjustmentService.targetedSubmit(ao, userId));
  }
}

@Controller('adjust/scope')
export class AdjustmentScopeController {
  constructor(private readonly adjustmentService: AdjustmentService) {}

  /** 3. 目标作用域校验 → valid/targetSummary（提交前拦截，D4） */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  async validate(
    @Body() ao: AdjustScopeValidateAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<AdjustScopeValidateVO>> {
    return Result.success(await this.adjustmentService.validateScope(ao, userId));
  }
}
