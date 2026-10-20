/**
 * 素材聚合根 schema — collection dl_asset（api-assets.md §5.3）。
 *
 * - _id=ObjectId 仅存储不进 VO（NR-08）；asset_id 业务主键（雪花串）+ 唯一索引
 * - 无结构化嵌入（元数据标量）；无出站引用；被 dl_brand_kit.logo_asset_id
 *   与版本 content 引用（ref_count 计数维护 INV-18）
 * - uk_user_hash{user_id,file_hash} unique：重复上传检测 INV-20（含软删行——
 *   同 hash 重传走复活路径而非撞唯一键）
 * - data_version 乐观锁（$inc）+ delete_sign 软删（查询默认 0）+ 审计字段平移
 * - 字段名沿契约 §5.3 snake_case（=v1 列平移，与其他域 schema 同口径）
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { AssetStatus, AssetType } from '../../common/enums';

@Schema({ collection: 'dl_asset', versionKey: false, timestamps: false })
export class Asset {
  /** 业务主键（雪花串，服务层生成） */
  @Prop({ type: String, required: true }) asset_id!: string;

  /** 名称（默认文件名） */
  @Prop({ type: String, required: true, maxlength: 128 }) asset_name!: string;

  /** 分类（自由文本目录；编辑可清空 → 可空） */
  @Prop({ type: String, default: null }) category?: string | null;

  /** 类型：AssetType（IMAGE/LOGO） */
  @Prop({ type: String, required: true, enum: Object.values(AssetType) }) asset_type!: string;

  /** 对象存储 key（{userId}/{fileHash}.{ext}，白名单字符构成，防穿越） */
  @Prop({ type: String, required: true }) storage_key!: string;

  /** 文件 SHA-256（重复检测 INV-20） */
  @Prop({ type: String, required: true }) file_hash!: string;

  /** 宽（px；图片尺寸读取为占位简化，可空） */
  @Prop({ type: Number, default: null }) width?: number | null;

  /** 高（px；同上可空） */
  @Prop({ type: Number, default: null }) height?: number | null;

  /** 文件大小（字节） */
  @Prop({ type: Number, required: true }) file_size!: number;

  /** 状态：AssetStatus（ACTIVE/DISABLED，启停生命周期） */
  @Prop({ type: String, required: true, enum: Object.values(AssetStatus) })
  asset_status!: string;

  /** 被引用计数（>0 禁删，INV-18；$inc 原子更新，GREATEST(0) 语义） */
  @Prop({ type: Number, required: true, default: 0, min: 0 }) ref_count!: number;

  /** 属主（隔离字段，ADR-005，服务端注入） */
  @Prop({ type: String, required: true }) user_id!: string;

  /** 乐观锁版本（更新 $inc；复活时重置 0，对齐 v1 revive SQL） */
  @Prop({ type: Number, required: true, default: 0 }) data_version!: number;

  /** 软删标记（0=未删除/1=已删除；查询默认过滤 0，hash 查重除外） */
  @Prop({ type: Number, required: true, default: 0 }) delete_sign!: number;

  /** 审计：创建人（userId；无昵称上下文，name 位留空） */
  @Prop({ type: String, default: null }) created_by?: string | null;

  @Prop({ type: String, default: null }) created_name?: string | null;

  @Prop({ type: Date, default: null }) created_time?: Date | null;

  @Prop({ type: String, default: null }) updated_by?: string | null;

  @Prop({ type: String, default: null }) updated_name?: string | null;

  /** 多端同步游标扫描依据（毫秒精度 + 业务 id 升序） */
  @Prop({ type: Date, default: null }) updated_time?: Date | null;
}

export type AssetDocument = Asset & Document;

export const AssetSchema = SchemaFactory.createForClass(Asset);

/* 声明式索引（api-assets.md §5.3 dl_asset） */
AssetSchema.index({ asset_id: 1 }, { unique: true, name: 'uk_asset_id' });
AssetSchema.index({ user_id: 1, file_hash: 1 }, { unique: true, name: 'uk_user_hash' });
AssetSchema.index(
  { user_id: 1, asset_type: 1, asset_status: 1 },
  { name: 'idx_user_type' },
);
