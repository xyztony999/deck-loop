import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Result } from '../common/result';
import {
  VersionCompareAO,
  VersionCompareVO,
  VersionDetailAO,
  VersionDetailVO,
  VersionForkAO,
  VersionRollbackAO,
  VersionTreeAO,
  VersionTreeVO,
} from './version.dto';
import { VersionManageService } from './version.manage-service';

/**
 * 版本管理接口（POST /ver/version/*，api-version §4.4 接口清单 1-5；
 * v1 VersionController 逐字对齐）。
 *
 * 个人单用户产品不建 RBAC（api-version §3.3）：无权限注解，全部接口=登录会话
 * + deck→version 级联属主隔离（@CurrentUser 服务端注入，NR-05；Service 层强制）。
 * HTTP 状态恒 200（@HttpCode(OK)，异常经全局 Filter 转 Result）。
 * 版本不可变：本控制器不含任何版本编辑/删除入口（api-version §3.2 约束）。
 */
@Controller('ver/version')
export class VersionController {
  constructor(private readonly versionManageService: VersionManageService) {}

  /** 1. 版本谱系树：tree（节点递归）+ branches（分支列表），branchScope=ALL/ACTIVE 默认 ACTIVE */
  @Post('tree')
  @HttpCode(HttpStatus.OK)
  async tree(
    @Body() ao: VersionTreeAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<VersionTreeVO>> {
    return Result.success(await this.versionManageService.tree(ao, userId));
  }

  /** 2. 版本详情：全字段 + content 完整 JSON（体积大，前端按页虚拟渲染） */
  @Post('detail')
  @HttpCode(HttpStatus.OK)
  async detail(
    @Body() ao: VersionDetailAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<VersionDetailVO>> {
    return Result.success(await this.versionManageService.detail(ao, userId));
  }

  /** 3. 版本对比：双版本差异（按页，changeKind 过程数据实时计算） */
  @Post('compare')
  @HttpCode(HttpStatus.OK)
  async compare(
    @Body() ao: VersionCompareAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<VersionCompareVO>> {
    return Result.success(await this.versionManageService.compare(ao, userId));
  }

  /** 4. 版本回退：移当前指针（Deck 须 ITERATING，历史不动） */
  @Post('rollback')
  @HttpCode(HttpStatus.OK)
  async rollback(
    @Body() ao: VersionRollbackAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<null>> {
    await this.versionManageService.rollback(ao, userId);
    return Result.success();
  }

  /** 5. 版本分叉：新命名分支（同 deck 唯一）+ activeBranch 切换 */
  @Post('fork')
  @HttpCode(HttpStatus.OK)
  async fork(
    @Body() ao: VersionForkAO,
    @CurrentUser('userId') userId: string,
  ): Promise<Result<null>> {
    await this.versionManageService.fork(ao, userId);
    return Result.success();
  }
}
