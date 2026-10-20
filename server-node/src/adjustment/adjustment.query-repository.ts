import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

/**
 * adjustment 域跨聚合只读查询（v1 AdjustQueryMapper 跨表 SQL 语义平移，Mongo raw
 * collection 版；generation 域 GenerationQueryRepository / deck 域 DeckStatsRepository
 * 同先例）。
 *
 * 背景（domain-manifest §3）：adjust 无自有 collection——调整指令为
 * instruction_snapshot 值对象，随 dl_generation_task / dl_deck_version 文档整体嵌入。
 * 本域仅有的两处跨聚合只读点均落在 **dl_deck_version**（version 域，insert-only
 * 无 delete_sign）：
 * - 基线版本归属/内容读取（v1 loadBaseVersion：deck 匹配 + 属主 + 内容非空 →
 *   BIZ_ADJUST_BASE_VERSION_INVALID，api-adjustment §3.4 本域契约码——
 *   version 域出口 getVersionContent(versionId,userId) 仅返回 content 且错误码为
 *   BIZ_VERSION_*，无法承载「不属于该 deck」判定，故按 raw 只读投影直查）；
 * - 分叉分支名早期冲突拦截（v1 countVersionBranch：confirm=true 要求 branchName，
 *   INV-12 同 deck 唯一，留档 uk_deck_branch 兜底，本查询提前拦截改善交互）。
 *
 * brandkit/话术模板存在性校验不走本类——优先消费 AssetDomainService 进程内接口
 * （getBrandKit / assertTemplatesExist，domain-manifest §6④）。
 *
 * 查询安全（NR-02/NR-03/NR-05）：查询服务端静态构造，入参仅作等值匹配值
 * （id/branchName 均经 DTO 校验后的受控字符串）；userId 隔离字段服务端注入，
 * 永不取信客户端键名；无任何写路径。
 */
@Injectable()
export class AdjustmentQueryRepository {
  /** dl_deck_version（version 域聚合，insert-only；字段契约 §5.3 snake_case 平移） */
  private static readonly COL_VERSION = 'dl_deck_version';

  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * 基线版本只读行（deck 匹配 + 属主 + 内容非空三重校验输入；v1
   * DeckVersionEntity 经 VersionDomainService#getById 全实体读取的调整域投影版）。
   * 不存在返回 null；content 为整体嵌入 object（pages[]→blocks[] 值对象树）。
   */
  async findBaseVersionRow(versionId: string): Promise<BaseVersionRow | null> {
    const row = await this.connection
      .collection(AdjustmentQueryRepository.COL_VERSION)
      .findOne(
        { version_id: versionId },
        { projection: { version_id: 1, deck_id: 1, user_id: 1, content: 1 } },
      );
    if (row === null) {
      return null;
    }
    const content = row.content;
    return {
      versionId: row.version_id === undefined ? null : String(row.version_id),
      deckId: row.deck_id === undefined ? null : String(row.deck_id),
      userId: row.user_id === undefined ? null : String(row.user_id),
      content:
        typeof content === 'object' && content !== null && !Array.isArray(content)
          ? (content as Record<string, unknown>)
          : null,
    };
  }

  /**
   * 分叉分支名早期冲突拦截（v1 countVersionBranch 对齐）：deck 下同名分支版本数。
   * >0 即已占用（活动分支可能尚无版本——与 deck.active_branch 的比对在 Service 层）。
   */
  countVersionBranch(deckId: string, branchName: string): Promise<number> {
    return this.connection
      .collection(AdjustmentQueryRepository.COL_VERSION)
      .countDocuments({ deck_id: deckId, branch_name: branchName });
  }
}

/** 基线版本只读投影行（snake_case collection → 域内 camelCase 收纳，_id 不出仓储 NR-08） */
export interface BaseVersionRow {
  versionId: string | null;
  deckId: string | null;
  userId: string | null;
  content: Record<string, unknown> | null;
}
