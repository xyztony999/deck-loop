import { Injectable } from '@nestjs/common';
import {
  ExportFormat,
  ExportStatus,
  getExportFormatLabel,
  getExportStatusLabel,
} from '../common/enums';
import { SelectOption } from '../common/result';
import { DICT_KEY_EXPORT_FORMAT, DICT_KEY_EXPORT_STATUS } from './deliver.constant';
import type { DeliverDictBatchVO } from './deliver.dto';

/**
 * deliver 域枚举字典 Service（POST /deliver/dict/batch；ExportFormat/ExportStatus，
 * api-delivery §4.4 接口清单 7；v1 DeliverDictRegistry 平移）。
 * 仅消费共享枚举，字典 key 与字段驼峰名一致（exportFormat/exportStatus）；
 * 未知 key 返回空列表（16-enum-dict 接口契约）。
 */
@Injectable()
export class DeliverDictService {
  batch(keys: string[]): DeliverDictBatchVO {
    const result: DeliverDictBatchVO = {};
    for (const key of keys) {
      result[key] = this.optionsOf(key);
    }
    return result;
  }

  private optionsOf(key: string): SelectOption[] {
    if (key === DICT_KEY_EXPORT_FORMAT) {
      return Object.values(ExportFormat).map((code) =>
        SelectOption.of(code, getExportFormatLabel(code)),
      );
    }
    if (key === DICT_KEY_EXPORT_STATUS) {
      return Object.values(ExportStatus).map((code) =>
        SelectOption.of(code, getExportStatusLabel(code)),
      );
    }
    return [];
  }
}
