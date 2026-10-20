import { Injectable } from '@nestjs/common';
import { TargetKind, getTargetKindLabel } from '../common/enums';
import { SelectOption } from '../common/result';
import type { AdjustDictBatchVO } from './adjustment.dto';

/**
 * adjustment 域枚举字典 Service（POST /adjust/dict/batch；TargetKind，
 * api-adjustment §4.4 接口清单 4；v1 AdjustDictServiceImpl 平移）。
 * 仅消费共享枚举，字典 key 与字段驼峰名一致（targetKind）；未知 key 返回空列表。
 */
@Injectable()
export class AdjustmentDictService {
  /** 字典 key：定向调整目标类型（instruction_snapshot adjust 节 targetKind） */
  static readonly KEY_TARGET_KIND = 'targetKind';

  batch(keys: string[]): AdjustDictBatchVO {
    const result: AdjustDictBatchVO = {};
    for (const key of keys) {
      result[key] = this.optionsOf(key);
    }
    return result;
  }

  private optionsOf(key: string): SelectOption[] {
    if (key === AdjustmentDictService.KEY_TARGET_KIND) {
      return Object.values(TargetKind).map((code) =>
        SelectOption.of(code, getTargetKindLabel(code)),
      );
    }
    return [];
  }
}
