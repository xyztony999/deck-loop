import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * adjustment 域跨聚合只读查询（v1 AdjustQueryMapper 跨表 SQL 语义平移；ADR-016 SQL 版；
 * generation 域 GenerationQueryRepository / deck 域 DeckStatsRepository 同先例）。
 *
 * 背景（domain-manifest §3）：adjust 无自有表——调整指令为 instruction_snapshot 值对象，
 * 随 dl_generation_task / dl_deck_version 行整体嵌入。本域仅有的两处跨聚合只读点均落在
 * **dl_deck_version**（version 域，insert-only 无 delete_sign）：
 * - 基线版本归属/内容读取（deck 匹配 + 属主 + 内容非空 → BIZ_ADJUST_BASE_VERSION_INVALID）；
 * - 分叉分支名早期冲突拦截（INV-12 同 deck 唯一，留档 uk_deck_branch 兜底，本查询提前拦截）。
 *
 * 查询安全（NR-02/NR-03/NR-05）：SQL 服务端静态构造，入参仅作绑定值；userId 隔离字段
 * 服务端注入；无任何写路径。
 */
@Injectable()
export class AdjustmentQueryRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * 基线版本只读行（deck 匹配 + 属主 + 内容非空三重校验输入）。
   * 不存在返回 null；content 为整体嵌入 jsonb（pages[]→blocks[] 值对象树）。
   */
  async findBaseVersionRow(versionId: string): Promise<BaseVersionRow | null> {
    const rows = await this.dataSource.query(
      `SELECT version_id, deck_id, user_id, content FROM dl_deck_version WHERE version_id = $1`,
      [versionId],
    );
    const row = rows[0];
    if (row == null) {
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
  async countVersionBranch(deckId: string, branchName: string): Promise<number> {
    const rows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt FROM dl_deck_version WHERE deck_id = $1 AND branch_name = $2`,
      [deckId, branchName],
    );
    return Number(rows[0]?.cnt ?? 0);
  }
}

/** 基线版本只读投影行（snake_case 列 → 域内 camelCase 收纳，无 _id，NR-08） */
export interface BaseVersionRow {
  versionId: string | null;
  deckId: string | null;
  userId: string | null;
  content: Record<string, unknown> | null;
}