/**
 * 素材文件限时 URL 端点 —— GET /files/{userId}/{hash}.{ext}?expires=&sign=。
 *
 * - v1 静态资源路径对齐（ASSET_URL_PUBLIC_BASE_URL 默认 .../files）；
 *   消费方：调整台/对比抽屉 <img>、导出渲染 fetchImageAsDataUri。
 * - 无会话依赖：HMAC 凭证即授权（domain-manifest §0：file-url 签发侧已校验
 *   属主 + 未删除；此处仅做凭证与路径校验，不查库）。
 * - 校验整体委托 AssetStorage#verifySigned（白名单形态 + 常量时间 HMAC +
 *   过期 + 防穿越）；成功以文件流响应，失败经全局过滤器转错误信封。
 * - svg 属可执行内容：响应加 CSP default-src 'none' + nosniff，其余图片
 *   类型仅 nosniff。
 */
import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { createReadStream, existsSync } from 'node:fs';

import { Public } from '../common/guards/auth.guard';
import { AssetStorageService } from './asset.storage';

/** 扩展名 → Content-Type（上传白名单 jpg/jpeg/png/svg/webp） */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

/** passthrough Response 的最小结构（避免直依赖 express 类型声明） */
interface HeaderSettable {
  set(name: string, value: string): unknown;
}

@Public()
@Controller('files')
export class AssetFilesController {
  constructor(private readonly storage: AssetStorageService) {}

  @Get(':userId/:name')
  @Header('Cache-Control', 'private, max-age=300')
  @Header('X-Content-Type-Options', 'nosniff')
  serve(
    @Param('userId') userId: string,
    @Param('name') name: string,
    @Query('expires') expires: string,
    @Query('sign') sign: string,
    @Res({ passthrough: true }) res: HeaderSettable,
  ): StreamableFile {
    const storageKey = `${userId}/${name}`;
    const filePath = this.storage.verifySigned(storageKey, expires, sign);
    if (!existsSync(filePath)) {
      throw new NotFoundException('素材文件不存在或已清理');
    }
    const contentType = CONTENT_TYPES[name.slice(name.lastIndexOf('.') + 1).toLowerCase()];
    if (contentType === 'image/svg+xml') {
      res.set('Content-Security-Policy', "default-src 'none'");
    }
    res.set('Content-Type', contentType ?? 'application/octet-stream');
    return new StreamableFile(createReadStream(filePath));
  }
}
