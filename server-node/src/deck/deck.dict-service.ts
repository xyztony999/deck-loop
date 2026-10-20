import { Injectable } from '@nestjs/common';
import { DeckStatus, DeckType, getDeckStatusLabel, getDeckTypeLabel } from '../common/enums';
import { SelectOption } from '../common/result';
import type { DeckDictBatchVO } from './deck.dto';

/**
 * deck 域枚举字典 Service（POST /deck/dict/batch；DeckType/DeckStatus，
 * api-deck §4.4 枚举字典端点；v1 DeckDictServiceImpl 平移）。
 * 仅消费共享枚举，字典 key 与字段驼峰名一致（deckType/deckStatus）；未知 key 返回空列表。
 */
@Injectable()
export class DeckDictService {
  batch(keys: string[]): DeckDictBatchVO {
    const result: DeckDictBatchVO = {};
    for (const key of keys) {
      result[key] = this.optionsOf(key);
    }
    return result;
  }

  private optionsOf(key: string): SelectOption[] {
    if (key === 'deckType') {
      return Object.values(DeckType).map((code) => SelectOption.of(code, getDeckTypeLabel(code)));
    }
    if (key === 'deckStatus') {
      return Object.values(DeckStatus).map((code) => SelectOption.of(code, getDeckStatusLabel(code)));
    }
    return [];
  }
}
