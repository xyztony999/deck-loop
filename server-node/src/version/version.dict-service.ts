import { Injectable } from '@nestjs/common';
import { VersionSourceType, getVersionSourceTypeLabel } from '../common/enums';
import { SelectOption } from '../common/result';
import type { VersionDictBatchVO } from './version.dto';

/**
 * version 域枚举字典 Service（POST /ver/dict/batch；VersionSourceType，
 * api-version §4.4 枚举字典端点；v1 VersionDictServiceImpl 平移）。
 * 仅消费共享枚举，字典 key 与字段驼峰名一致（versionSourceType）；未知 key 返回空列表。
 */
@Injectable()
export class VersionDictService {
  batch(keys: string[]): VersionDictBatchVO {
    const result: VersionDictBatchVO = {};
    for (const key of keys) {
      result[key] = this.optionsOf(key);
    }
    return result;
  }

  private optionsOf(key: string): SelectOption[] {
    if (key === 'versionSourceType') {
      return Object.values(VersionSourceType).map((code) =>
        SelectOption.of(code, getVersionSourceTypeLabel(code)),
      );
    }
    return [];
  }
}
