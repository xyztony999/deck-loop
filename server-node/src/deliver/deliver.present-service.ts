import { Injectable } from '@nestjs/common';
import { AssetDomainService } from '../asset/asset.service';
import { DeckDomainService } from '../deck/deck.domain-service';
import { VersionArchiveService } from '../version/version.archive-service';
import { BizException } from '../common/exceptions';
import { ASSET_URL_BATCH } from './deliver.constant';
import { EXPORT_NOT_FINALIZED } from './deliver.errors';
import { PresentDataAO, PresentDataVO } from './deliver.dto';
import { ExportTaskRepository } from './deliver.repository';
import {
  assertSnapshotShape,
  extractSnapshotAssetIds,
  toPresentPages,
} from './deliver.snapshot-support';

/**
 * 演示放映服务（S-03，只读派生数据，api-delivery §4.4；v1 PresentServiceImpl 平移）。
 *
 * FINALIZED 守卫（D2，DeckDomainService#assertFinalized）；放映数据锚定
 * finalVersionId 快照（content + 演讲者备注 note），图片块注入素材限时 URL
 * （asset 域 OHS signFileUrls 进程内消费，会话线程签发；未命中素材
 * assetFileUrl=null 透出，演示端按缺失处理）。
 */
@Injectable()
export class PresentService {
  constructor(
    private readonly repository: ExportTaskRepository,
    private readonly deckDomainService: DeckDomainService,
    private readonly versionArchiveService: VersionArchiveService,
    private readonly assetDomainService: AssetDomainService,
  ) {}

  /** 演示数据：deckName/finalVersionSeq/pages（渲染就绪结构，演示模式全屏消费） */
  async presentData(ao: PresentDataAO, userId: string): Promise<PresentDataVO> {
    // D2 守卫链：存在 → 属主 → FINALIZED（deck 域契约，deck 域错误码透传）
    const { deckId, finalVersionId } = await this.deckDomainService.assertFinalized(
      ao.deckId,
      userId,
    );

    if (finalVersionId == null || finalVersionId.trim().length === 0) {
      throw new BizException(EXPORT_NOT_FINALIZED, '定稿版本缺失，无法演示');
    }
    // INV-14 防御校验：定稿版本归属该 deck + versionSeq 冗余（deliver 域只读投影）
    const [deckRefs, versionRefs] = await Promise.all([
      this.repository.findDeckRefs([deckId]),
      this.repository.findVersionRefs([finalVersionId]),
    ]);
    const versionRef = versionRefs.get(finalVersionId);
    if (versionRef == null || versionRef.deckId !== deckId) {
      throw new BizException(EXPORT_NOT_FINALIZED, '定稿版本快照缺失，无法演示');
    }

    // 版本内容快照（version→deck→user 级联归属校验在 getVersionContent 内）
    const content = await this.versionArchiveService.getVersionContent(finalVersionId, userId);
    try {
      assertSnapshotShape(content);
    } catch {
      throw new BizException(EXPORT_NOT_FINALIZED, '定稿版本快照缺失，无法演示');
    }

    // 图片块素材限时 URL（渲染就绪结构；未命中素材 assetFileUrl=null 透出）
    const assetFileUrls = await this.signAssetFileUrls(
      userId,
      extractSnapshotAssetIds(content),
    );

    return PresentDataVO.of(
      deckId,
      deckRefs.get(deckId)?.deckName ?? '',
      versionRef.versionSeq,
      toPresentPages(content, assetFileUrls),
    );
  }

  /** 素材限时 URL 批量签发（asset 域 OHS signFileUrls 进程内消费；≤50/批，v1 对齐） */
  private async signAssetFileUrls(
    userId: string,
    assetIds: string[],
  ): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    if (assetIds.length === 0) {
      return urls;
    }
    for (let from = 0; from < assetIds.length; from += ASSET_URL_BATCH) {
      const batch = assetIds.slice(from, Math.min(assetIds.length, from + ASSET_URL_BATCH));
      const signed = await this.assetDomainService.signFileUrls(userId, batch);
      for (const item of signed) {
        urls.set(item.assetId, item.url);
      }
    }
    return urls;
  }
}
