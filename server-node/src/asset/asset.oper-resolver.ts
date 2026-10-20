/**
 * asset 域行操作列解析器 —— v1 impl/{Asset,BrandKit,PromptTemplate}OperResolver 对齐
 * （替代 v1 @DataResponseTransfer AOP；状态判断经枚举 code，禁字面量）。
 */
import { Injectable } from '@nestjs/common';
import { AssetStatus, YesNo } from '../common/enums';
import { OperItem } from '../common/result';

/** 素材行 operList（api-assets §4.4 asset/list）：edit 恒有；disable=ACTIVE；enable=DISABLED；delete=refCount=0（INV-18） */
@Injectable()
export class AssetOperResolver {
  resolve(assetStatus: string, refCount: number): OperItem[] {
    const operList: OperItem[] = [OperItem.of('edit', '编辑')];
    if (assetStatus === AssetStatus.ACTIVE) {
      operList.push(OperItem.of('disable', '停用'));
    }
    if (assetStatus === AssetStatus.DISABLED) {
      operList.push(OperItem.of('enable', '启用'));
    }
    if (refCount === 0) {
      operList.push(OperItem.of('delete', '删除', 'danger'));
    }
    return operList;
  }
}

/** 规范行 operList：edit 恒有；set-default/delete=非默认（删除另有 deck 引用运行时校验） */
@Injectable()
export class BrandKitOperResolver {
  resolve(isDefault: number): OperItem[] {
    const operList: OperItem[] = [OperItem.of('edit', '编辑')];
    if (isDefault !== YesNo.YES) {
      operList.push(OperItem.of('set-default', '设为默认'));
      operList.push(OperItem.of('delete', '删除', 'danger'));
    }
    return operList;
  }
}

/** 话术行 operList：话术无引用约束，edit/delete 恒有 */
@Injectable()
export class PromptTemplateOperResolver {
  resolve(): OperItem[] {
    return [OperItem.of('edit', '编辑'), OperItem.of('delete', '删除', 'danger')];
  }
}
