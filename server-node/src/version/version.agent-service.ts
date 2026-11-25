import { Injectable } from '@nestjs/common';
import { DeckStatus, VersionSourceType } from '../common/enums';
import { BizException } from '../common/exceptions';
import { nextId } from '../common/utils/snowflake';
import { DECK_NOT_FOUND, DECK_NOT_FOUND_MSG, DECK_STATUS_FORBIDDEN } from '../deck/deck.errors';
import { DeckDomainService } from '../deck/deck.domain-service';
import { VersionArchiveService } from './version.archive-service';
import { assertTargetedInvariance } from './targeted-invariance';
import { blockList, pageList, textOf } from './version.content-support';
import {
  AgentCreateAO,
  AgentCreateVO,
  VersionArchiveCommand,
} from './version.dto';
import { VERSION_TARGET_INVARIANCE } from './version.errors';

/** content 体积红线缺省（MB；env AGENT_CONTENT_MAX_MB 覆盖；1.6G 内存红线 ADR-016） */
const DEFAULT_CONTENT_MAX_MB = 2;

/** pages 红线（api-web-agent §3.2：1~200） */
const MIN_PAGES = 1;
const MAX_PAGES = 200;

/** instruction 红线（≤2000 字） */
const MAX_INSTRUCTION_LENGTH = 2000;

/** blockType 值域（api-version §4.1 content 契约；值对象内字符串，未入枚举池） */
const BLOCK_TYPES = ['TEXT', 'IMAGE', 'PLACEHOLDER'];

/** content 体积上限（字节；env AGENT_CONTENT_MAX_MB 缺省 2，正数兜底） */
export function agentContentMaxBytes(): number {
  const parsed = Number.parseFloat(process.env.AGENT_CONTENT_MAX_MB ?? '');
  const mb = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CONTENT_MAX_MB;
  return Math.floor(mb * 1024 * 1024);
}

/**
 * agent 直写应用服务（POST /ver/version/agent-create，api-web-agent §4.2；ADR-018）。
 *
 * **唯一内容写入口红线（06 §8.2）**：本服务只做守卫与命令组装，落库经
 * VersionArchiveService.createVersionFromTask 单事务（seq FOR UPDATE→insert-only→
 * movePointer→adjustRefCounts）+ 首版 onFirstVersionCreated + 提交后 ver_version_created
 * ——与 ADR-017 本地 MCP version_create 同一服务同一事务，线上/本地零分叉。
 *
 * 编排步骤（契约顺序）：
 * 1. 守卫 userId 由 ApiTokenGuard 注入（仅 X-Api-Token，网站会话不可调用）；
 * 2. 载荷红线（content ≤2MB/pages 1~200/instruction ≤2000/形状）——不可信输入，
 *    越界 BIZ_VERSION_TARGET_INVARIANCE（BIZ 错误，不产版本，D6）；
 * 3. deck 存在且属主（BIZ_DECK_NOT_FOUND）；状态 DRAFT/ITERATING（INV-3）；
 * 4. sourceType 自动判定：scope≠null→TARGETED_ADJUST；基线≠null→FULL_ADJUST；
 *    否则 FULL_GENERATE；
 * 5. 定向分支：基线必存 + content 固化进 instruction_snapshot.baseContent +
 *    targetPath=scope + INV-9 scope 存在性 + assertTargetedInvariance；
 * 6. taskId=agent-<snowflake>（不建 dl_generation_task 行，D2）→ 单事务归档；
 * 7. 首版（归档前 deck=DRAFT）→ onFirstVersionCreated（DRAFT→ITERATING，幂等 INV-4）。
 */
@Injectable()
export class VersionAgentService {
  constructor(
    private readonly deckDomainService: DeckDomainService,
    private readonly versionArchiveService: VersionArchiveService,
  ) {}

  async agentCreate(ao: AgentCreateAO, userId: string): Promise<AgentCreateVO> {
    if (typeof userId !== 'string' || userId.trim().length === 0) {
      throw new BizException(DECK_NOT_FOUND, '缺少用户上下文');
    }
    const content = ao.content;
    this.assertPayloadRedlines(content, ao.instruction);

    const deck = await this.deckDomainService.getDeck(ao.deckId, userId);
    if (deck == null) {
      throw new BizException(DECK_NOT_FOUND, DECK_NOT_FOUND_MSG);
    }
    // INV-3：FINALIZED/ARCHIVED 禁内容写入
    if (deck.deck_status !== DeckStatus.DRAFT && deck.deck_status !== DeckStatus.ITERATING) {
      throw new BizException(DECK_STATUS_FORBIDDEN, '已定稿或归档的创作物禁止写入版本');
    }

    const baselineId = firstNonBlank(ao.parentVersionId, deck.current_version_id);
    const sourceType =
      ao.scope != null
        ? VersionSourceType.TARGETED_ADJUST
        : baselineId != null
          ? VersionSourceType.FULL_ADJUST
          : VersionSourceType.FULL_GENERATE;

    const taskId = `agent-${nextId()}`;
    const instructionSnapshot: Record<string, unknown> = { instruction: ao.instruction };
    if (ao.scope != null) {
      // 定向分支：基线必存（无基线拒绝）+ 固化 + INV-9 + 非目标不变性
      if (baselineId == null) {
        throw new BizException(VERSION_TARGET_INVARIANCE, '定向调整须有基线版本（首版请用整稿生成）');
      }
      const baseContent = await this.versionArchiveService.getVersionContent(baselineId, userId);
      this.assertScopeExists(baseContent, ao.scope.pageId, ao.scope.blockId);
      instructionSnapshot['targetPath'] =
        ao.scope.blockId != null
          ? { pageId: ao.scope.pageId, blockId: ao.scope.blockId }
          : { pageId: ao.scope.pageId };
      instructionSnapshot['baseContent'] = baseContent;
      assertTargetedInvariance(instructionSnapshot, content, taskId);
    }

    const command = new VersionArchiveCommand();
    command.deckId = ao.deckId;
    command.userId = userId;
    command.taskId = taskId;
    command.sourceType = sourceType;
    command.instructionSnapshot = instructionSnapshot;
    command.content = content;
    command.parentVersionId = ao.parentVersionId ?? null;
    command.branchName = ao.branchName ?? null;

    const wasDraft = deck.deck_status === DeckStatus.DRAFT;
    // 版本写入唯一入口（内部单事务 + 提交后 ver_version_created，NR-07）
    const archived = await this.versionArchiveService.createVersionFromTask(command);
    if (wasDraft) {
      // INV-4 首版流转 DRAFT→ITERATING（幂等；deck 域内发 deck_deck_status-changed）
      await this.deckDomainService.onFirstVersionCreated(ao.deckId, userId);
    }
    const branchName = firstNonBlank(ao.branchName, deck.active_branch) ?? 'main';
    return AgentCreateVO.of(archived.versionId, archived.versionSeq, sourceType, taskId, branchName);
  }

  /* ------------------------------------------------------------------ */
  /* 载荷红线（不可信输入；越界 BIZ_VERSION_TARGET_INVARIANCE，不产版本）   */
  /* ------------------------------------------------------------------ */

  private assertPayloadRedlines(content: Record<string, unknown>, instruction: string): void {
    if (typeof instruction !== 'string' || instruction.trim().length === 0) {
      throw new BizException(VERSION_TARGET_INVARIANCE, 'instruction不能为空');
    }
    if (instruction.length > MAX_INSTRUCTION_LENGTH) {
      throw new BizException(VERSION_TARGET_INVARIANCE, `instruction长度不能超过${MAX_INSTRUCTION_LENGTH}字`);
    }
    const maxBytes = agentContentMaxBytes();
    const bytes = Buffer.byteLength(JSON.stringify(content), 'utf8');
    if (bytes > maxBytes) {
      throw new BizException(
        VERSION_TARGET_INVARIANCE,
        `content体积超过${Math.floor(maxBytes / 1024 / 1024)}MB上限`,
      );
    }
    const pages = pageList(content);
    if (!Array.isArray(content['pages']) || pages.length < MIN_PAGES || pages.length > MAX_PAGES) {
      throw new BizException(VERSION_TARGET_INVARIANCE, `页数须在${MIN_PAGES}~${MAX_PAGES}之间`);
    }
    // 形状校验（api-version §4.1 content 契约；pageId/blockId/blockType）
    for (const page of pages) {
      if (textOf(page['pageId']).trim().length === 0) {
        throw new BizException(VERSION_TARGET_INVARIANCE, '存在缺少pageId的页');
      }
      if (!Array.isArray(page['blocks'])) {
        throw new BizException(VERSION_TARGET_INVARIANCE, `页${textOf(page['pageId'])}缺少blocks数组`);
      }
      for (const block of blockList(page)) {
        if (textOf(block['blockId']).trim().length === 0) {
          throw new BizException(VERSION_TARGET_INVARIANCE, '存在缺少blockId的块');
        }
        if (!BLOCK_TYPES.includes(textOf(block['blockType']))) {
          throw new BizException(
            VERSION_TARGET_INVARIANCE,
            `块类型非法[${textOf(block['blockType'])}]，仅支持TEXT/IMAGE/PLACEHOLDER`,
          );
        }
      }
    }
  }

  /** INV-9：scope.pageId/blockId 必须存在于基线 content */
  private assertScopeExists(
    baseContent: Record<string, unknown>,
    pageId: string,
    blockId: string | undefined,
  ): void {
    const page = pageList(baseContent).find((p) => textOf(p['pageId']) === pageId);
    if (page === undefined) {
      throw new BizException(VERSION_TARGET_INVARIANCE, `目标页不存在于基线内容[${pageId}]`);
    }
    if (blockId != null && blockId.trim().length > 0) {
      const block = blockList(page).find((b) => textOf(b['blockId']) === blockId);
      if (block === undefined) {
        throw new BizException(VERSION_TARGET_INVARIANCE, `目标块不存在于基线内容[${blockId}]`);
      }
    }
  }
}

function firstNonBlank(
  first: string | null | undefined,
  second: string | null | undefined,
): string | null {
  if (first != null && first.trim().length > 0) {
    return first;
  }
  return second != null && second.trim().length > 0 ? second : null;
}