import { Injectable, Logger } from '@nestjs/common';
import type {
  AiProviderAdapter,
  ProviderCallContext,
  ProviderCallResult,
} from './ai-provider-adapter';

/**
 * 内置模拟 provider 适配器（默认渠道 MOCK，联调/E2E 用）。
 *
 * F03（功能核查 2026-10-20）：产物必须满足 api-version §4.1 内容契约——
 * pages[].pageId 与 blocks[].blockId 稳定且唯一，否则客户端预览过滤块、
 * 定向调整 scope 解析失败（page-1 前端兜底页在后端不存在）。本实现按
 * 指令快照构造：
 * - generateOutline：topic 驱动的三节点大纲（nodeId/pageHint 稳定）；
 * - generateContent：outlineSnapshot 逐节点成页（p1..pN + pN-bM 块，
 *   assetContext 存在时穿插 IMAGE 块引用真实素材 ID）；
 * - adjustContent：baseContent 克隆后做**可验证的最小变更**——TARGETED 仅改
 *   目标作用域（非目标页/块逐字节不动，满足回调侧不变性校验），
 *   FULL 在全部 TEXT 块追加调整标记（ID 全保留）。
 *
 * - token 按快照/产物长度估算（snapshot/10、content/4，下限 1）；
 * - 密钥已注入 context（证明密钥链路可达），本实现不外传、不打日志（仅打布尔值）；
 * - 真实厂商接入时走 OpenAiCompatibleProviderAdapter，勿在本类堆砌分支。
 */
@Injectable()
export class MockAiProviderAdapter implements AiProviderAdapter {
  /** 模拟渠道编码（与内置默认渠道注册一致） */
  static readonly CHANNEL_CODE = 'MOCK';

  private readonly logger = new Logger(MockAiProviderAdapter.name);

  channelCode(): string {
    return MockAiProviderAdapter.CHANNEL_CODE;
  }

  async generateOutline(context: ProviderCallContext): Promise<ProviderCallResult> {
    const snap = this.parseSnapshot(context);
    const topic = textOf(snap?.['topic']) || '未命名主题';
    const content = JSON.stringify([
      {
        nodeId: 'n1',
        title: `${topic} · 背景与目标`,
        points: ['行业背景一句话', '本次沟通的目标'],
        note: 'MOCK 渠道生成',
        pageHint: 1,
      },
      {
        nodeId: 'n2',
        title: `${topic} · 核心方案`,
        points: ['方案要点一', '方案要点二', '方案要点三'],
        pageHint: 1,
      },
      {
        nodeId: 'n3',
        title: `${topic} · 计划与展望`,
        points: ['阶段计划', '预期收益'],
        pageHint: 1,
      },
    ]);
    await sleepQuietly();
    return this.buildResult(context, content);
  }

  async generateContent(context: ProviderCallContext): Promise<ProviderCallResult> {
    const snap = this.parseSnapshot(context);
    const outlineNodes = recordArrayOf(snap?.['outlineSnapshot']);
    const assetIds = recordArrayOf(snap?.['assetContext']).map((a) => textOf(a['assetId']));
    const nodes = outlineNodes.length > 0 ? outlineNodes : [{ title: '模拟页面' }];

    const pages = nodes.map((node, index): Record<string, unknown> => {
      const pageNo = index + 1;
      const title = textOf(node['title']) || `第${pageNo}页`;
      const points = recordArrayOf(node['points']).map((p) => textOf(p)).filter((t) => t.length > 0);
      const blocks: Record<string, unknown>[] = [
        {
          blockId: `p${pageNo}-b1`,
          blockType: 'TEXT',
          text: points.length > 0 ? points.join('\n') : `「${title}」要点说明（MOCK 渠道生成内容）`,
        },
      ];
      const assetId = assetIds[(index - 1 + assetIds.length) % Math.max(1, assetIds.length)];
      if (index > 0 && assetId) {
        blocks.push({ blockId: `p${pageNo}-b2`, blockType: 'IMAGE', assetId });
      }
      return { pageId: `p${pageNo}`, pageNo, title, blocks };
    });

    const content = JSON.stringify({ pages, meta: { channel: MockAiProviderAdapter.CHANNEL_CODE } });
    await sleepQuietly();
    return this.buildResult(context, content);
  }

  async adjustContent(context: ProviderCallContext): Promise<ProviderCallResult> {
    const snap = this.parseSnapshot(context);
    const baseContent = recordOf(snap?.['baseContent']);
    const content =
      baseContent !== null
        ? JSON.stringify(this.adjustBase(context.task.taskType, snap, baseContent))
        : JSON.stringify({
            pages: [
              {
                pageId: 'p1',
                pageNo: 1,
                title: '调整后页面',
                blocks: [{ blockId: 'p1-b1', blockType: 'TEXT', text: 'MOCK 渠道调整内容（无基线兜底）' }],
              },
            ],
            meta: { channel: MockAiProviderAdapter.CHANNEL_CODE },
          });
    await sleepQuietly();
    return this.buildResult(context, content);
  }

  /* ------------------------------------------------------------------ */
  /* 内部：快照驱动的产物构造                                             */
  /* ------------------------------------------------------------------ */

  /** 指令快照解析（序列化字符串 → 容器；非法/缺失返回 null 走兜底产物） */
  private parseSnapshot(context: ProviderCallContext): Record<string, unknown> | null {
    const raw = context.task.instructionSnapshot;
    if (typeof raw !== 'string' || raw.length === 0) {
      return null;
    }
    return recordOf(safeJsonParse(raw));
  }

  /**
   * 基线内容克隆后按 taskType 做最小变更（深克隆经 JSON 往返，原始快照不可污染）：
   * - TARGETED_ADJUST：仅目标页/目标块追加调整标记，其余逐字节不动；
   * - FULL_ADJUST（及未知类型）：全部 TEXT 块追加标记，pageId/blockId 全保留。
   * taskType 取 context.task（指令快照不承载该字段）。
   */
  private adjustBase(
    taskType: string,
    snap: Record<string, unknown> | null,
    baseContent: Record<string, unknown>,
  ): Record<string, unknown> {
    const clone = safeJsonParse(JSON.stringify(baseContent));
    const doc = recordOf(clone);
    if (doc === null) {
      throw new Error('MOCK adjust：基线内容克隆失败');
    }
    const mark = `（MOCK 已按指令调整：${textOf(snap?.['instructionText']) || '整稿微调'}）`;

    if (taskType === 'TARGETED_ADJUST') {
      const path = recordOf(snap?.['targetPath']);
      const pageId = textOf(path?.['pageId']);
      const blockId = textOf(path?.['blockId']);
      for (const page of recordArrayOf(doc['pages'])) {
        if (textOf(page['pageId']) !== pageId) {
          continue;
        }
        if (blockId === '') {
          page['title'] = textOf(page['title']) + mark;
          for (const block of recordArrayOf(page['blocks'])) {
            appendMark(block, mark);
          }
        } else {
          for (const block of recordArrayOf(page['blocks'])) {
            if (textOf(block['blockId']) === blockId) {
              appendMark(block, mark);
            }
          }
        }
        break;
      }
      return doc;
    }

    for (const page of recordArrayOf(doc['pages'])) {
      for (const block of recordArrayOf(page['blocks'])) {
        appendMark(block, mark);
      }
    }
    return doc;
  }

  private buildResult(context: ProviderCallContext, content: string): ProviderCallResult {
    const task = context.task;
    const snapshotLen = task.instructionSnapshot?.length ?? 0;
    const keyConfigured = context.apiKey.length > 0;
    this.logger.debug(
      `MOCK provider 调用完成 taskId=${task.taskId} type=${task.taskType} apiKeyConfigured=${keyConfigured}`,
    );
    return {
      content,
      promptTokens: Math.max(1, Math.floor(snapshotLen / 10)),
      completionTokens: Math.max(1, Math.floor(content.length / 4)),
    };
  }
}

/** TEXT 块追加调整标记（IMAGE/PLACEHOLDER 不动；无 text 字段时补写） */
function appendMark(block: Record<string, unknown>, mark: string): void {
  if (String(block['blockType'] ?? '').toUpperCase() === 'TEXT') {
    block['text'] = textOf(block['text']) + mark;
  }
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function recordArrayOf(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 模拟时延（300~800ms；timer unref 不阻塞进程退出） */
function sleepQuietly(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), 300 + Math.floor(Math.random() * 500));
    timer.unref?.();
  });
}
