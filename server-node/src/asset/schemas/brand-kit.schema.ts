/**
 * 品牌规范聚合根 schema — collection dl_brand_kit（api-assets.md §5.3）。
 *
 * - colors/fonts 为 JSON 值对象（D3）：无独立生命周期，整体嵌入（_id: false）
 * - logo_asset_id → dl_asset 业务 id 引用（仅存 id；INV-16 启用态守卫在应用层）
 * - is_default 用户维度唯一（INV-17：set-default 多文档事务切换）
 * - 字段名沿契约 §5.3 snake_case（=v1 列平移，与其他域 schema 同口径）
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/** 色彩值对象（{primary,assistants[]}，整体嵌入） */
@Schema()
export class BrandKitColors {
  /** 主色 */
  @Prop({ type: String, required: true, maxlength: 32 }) primary!: string;

  /** 辅色数组（≤16 项） */
  @Prop({ type: [String], default: [] }) assistants?: string[];
}

/** 字体值对象（{title, body}，预置清单引用名，整体嵌入，可空） */
@Schema()
export class BrandKitFonts {
  @Prop({ type: String, default: null }) title?: string | null;

  @Prop({ type: String, default: null }) body?: string | null;
}

@Schema({ collection: 'dl_brand_kit', versionKey: false, timestamps: false })
export class BrandKit {
  /** 业务主键（雪花串，服务层生成） */
  @Prop({ type: String, required: true }) brand_kit_id!: string;

  /** 规范名称（≤50） */
  @Prop({ type: String, required: true, maxlength: 50 }) kit_name!: string;

  /** 色彩值对象（嵌入） */
  @Prop({ type: BrandKitColors, _id: false }) colors!: BrandKitColors;

  /** 字体值对象（嵌入，可空；编辑可清空） */
  @Prop({ type: BrandKitFonts, _id: false, default: null }) fonts?: BrandKitFonts | null;

  /** logo 素材引用（dl_asset 业务 id；INV-16 启用态守卫；解绑清空） */
  @Prop({ type: String, default: null }) logo_asset_id?: string | null;

  /** 是否默认规范（用户维度唯一，INV-17）：1-是 / 0-否（YesNo INT(1) 语义） */
  @Prop({ type: Number, required: true, default: 0 }) is_default!: number;

  /** 属主（隔离字段，ADR-005，服务端注入） */
  @Prop({ type: String, required: true }) user_id!: string;

  /** 乐观锁版本（更新 $inc） */
  @Prop({ type: Number, required: true, default: 0 }) data_version!: number;

  /** 软删标记（0=未删除/1=已删除） */
  @Prop({ type: Number, required: true, default: 0 }) delete_sign!: number;

  @Prop({ type: String, default: null }) created_by?: string | null;

  @Prop({ type: String, default: null }) created_name?: string | null;

  @Prop({ type: Date, default: null }) created_time?: Date | null;

  @Prop({ type: String, default: null }) updated_by?: string | null;

  @Prop({ type: String, default: null }) updated_name?: string | null;

  /** 多端同步游标扫描依据 */
  @Prop({ type: Date, default: null }) updated_time?: Date | null;
}

export type BrandKitDocument = BrandKit & Document;

export const BrandKitSchema = SchemaFactory.createForClass(BrandKit);

/* 声明式索引（api-assets.md §5.3 dl_brand_kit） */
BrandKitSchema.index({ brand_kit_id: 1 }, { unique: true, name: 'uk_brand_kit_id' });
BrandKitSchema.index({ user_id: 1, delete_sign: 1 }, { name: 'idx_user' });
