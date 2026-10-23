import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Result } from '../common/result';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChannelAdminService } from './channel-admin.service';
import { ChannelPreferenceService } from './channel.service';
import {
  ChannelAdminCodeAO,
  ChannelAdminItemVO,
  ChannelAdminListVO,
  ChannelAdminSaveAO,
  ChannelAdminSetEnabledAO,
  ChannelAdminTestAO,
  ChannelAdminTestVO,
  ChannelPreferenceDetailVO,
  ChannelPreferenceSaveAO,
  ChannelUsageSummaryAO,
  ChannelUsageSummaryVO,
  ModelOptionAO,
  ModelOptionVO,
} from './channel.dto';

/**
 * 渠道偏好接口（api-channel §4.4 接口清单 #1-#4；v1 三个 @RestController
 * （preference/usage/select）合并为本域单 Controller，路径逐字不变）。
 *
 * - 偏好与用户 1:1（D1）：无 list 分页；会话+属主（偏好天然单行属主，§3.3）
 * - 隔离字段 userId 服务端注入（@CurrentUser，ADR-005/NR-05），永不取信客户端入参
 * - 无 @Public 端点（domain-manifest §7）；无 dict 端点（档位键=TaskType，无独立业务枚举）
 * - @HttpCode(200)：v1 Spring POST 语义对齐（NestJS @Post 默认 201）
 * - Controller 不写业务逻辑（NR-10）
 */
@Controller('channel')
export class ChannelController {
  constructor(
    private readonly channelPreferenceService: ChannelPreferenceService,
    private readonly adminService: ChannelAdminService,
  ) {}

  /** #1 偏好详情（含渠道可用性标注/平台兜底只读展示） */
  @Post('preference/detail')
  @HttpCode(HttpStatus.OK)
  async detail(
    @CurrentUser('userId') userId: string,
  ): Promise<Result<ChannelPreferenceDetailVO>> {
    return Result.success(await this.channelPreferenceService.detail(userId));
  }

  /** #2 偏好保存（upsert，逐项 INV-22 校验；空值档位=清除回落默认） */
  @Post('preference/save')
  @HttpCode(HttpStatus.OK)
  async save(
    @CurrentUser('userId') userId: string,
    @Body() ao: ChannelPreferenceSaveAO,
  ): Promise<Result<null>> {
    await this.channelPreferenceService.save(userId, ao);
    return Result.success();
  }

  /** #3 用量汇总（dimension=CHANNEL/DECK/TASK_TYPE；DECK 维度分页；时间范围 ≤12 个月） */
  @Post('usage/summary')
  @HttpCode(HttpStatus.OK)
  async usageSummary(
    @CurrentUser('userId') userId: string,
    @Body() ao: ChannelUsageSummaryAO,
  ): Promise<Result<ChannelUsageSummaryVO>> {
    return Result.success(await this.channelPreferenceService.usageSummary(userId, ao));
  }

  /** #4 渠道选择器（选择池 channel.select.modelOptions；capabilityTag 可选过滤） */
  @Post('select/model-options')
  @HttpCode(HttpStatus.OK)
  modelOptions(@Body() ao: ModelOptionAO): Result<ModelOptionVO[]> {
    return Result.success(this.channelPreferenceService.modelOptions(ao));
  }

  /* ---------------- 渠道管理端（channel-admin-2026-10-23 §4） ---------------- */

  /** #5 渠道清单（全量；密钥掩码） */
  @Post('admin/list')
  @HttpCode(HttpStatus.OK)
  async adminList(): Promise<Result<ChannelAdminListVO>> {
    return Result.success(await this.adminService.list());
  }

  /** #6 渠道详情（编辑回显；无明文密钥） */
  @Post('admin/detail')
  @HttpCode(HttpStatus.OK)
  async adminDetail(@Body() ao: ChannelAdminCodeAO): Promise<Result<ChannelAdminItemVO>> {
    return Result.success(await this.adminService.detail(ao));
  }

  /** #7 渠道保存（新建/编辑；落库即热生效） */
  @Post('admin/save')
  @HttpCode(HttpStatus.OK)
  async adminSave(
    @CurrentUser('userId') userId: string,
    @Body() ao: ChannelAdminSaveAO,
  ): Promise<Result<null>> {
    return Result.success(await this.adminService.save(userId, ao));
  }

  /** #8 渠道启停（builtin 允许；落库即热生效） */
  @Post('admin/set-enabled')
  @HttpCode(HttpStatus.OK)
  async adminSetEnabled(
    @CurrentUser('userId') userId: string,
    @Body() ao: ChannelAdminSetEnabledAO,
  ): Promise<Result<null>> {
    return Result.success(await this.adminService.setEnabled(userId, ao));
  }

  /** #9 连通性测试（真实最小请求，10s 超时；失败回显原因不抛错） */
  @Post('admin/test')
  @HttpCode(HttpStatus.OK)
  async adminTest(@Body() ao: ChannelAdminTestAO): Promise<Result<ChannelAdminTestVO>> {
    return Result.success(await this.adminService.test(ao));
  }
}
