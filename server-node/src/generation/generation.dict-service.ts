import { Injectable } from '@nestjs/common';
import { TaskStatus, TaskType, getTaskStatusLabel, getTaskTypeLabel } from '../common/enums';
import { SelectOption } from '../common/result';
import type { GenerationDictBatchVO } from './generation.dto';

/**
 * generation 域枚举字典 Service（POST /gen/dict/batch；TaskType/TaskStatus，
 * api-generation §4.4 枚举字典端点；v1 GenerationDictServiceImpl 平移）。
 * 仅消费共享枚举，字典 key 与字段驼峰名一致（taskType/taskStatus）；未知 key 返回空列表。
 */
@Injectable()
export class GenerationDictService {
  batch(keys: string[]): GenerationDictBatchVO {
    const result: GenerationDictBatchVO = {};
    for (const key of keys) {
      result[key] = this.optionsOf(key);
    }
    return result;
  }

  private optionsOf(key: string): SelectOption[] {
    if (key === 'taskType') {
      return Object.values(TaskType).map((code) => SelectOption.of(code, getTaskTypeLabel(code)));
    }
    if (key === 'taskStatus') {
      return Object.values(TaskStatus).map((code) => SelectOption.of(code, getTaskStatusLabel(code)));
    }
    return [];
  }
}
