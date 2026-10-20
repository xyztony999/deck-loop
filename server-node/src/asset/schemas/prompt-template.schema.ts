/**
 * 话术模板聚合根（薄）schema — collection dl_prompt_template（api-assets.md §5.3，S-02）。
 *
 * - content 为含 {占位符} 的 string 值（无结构化嵌入；占位符语法元数据即 content 本身，
 *   语法校验 INV-21 于 save 应用层执行：{名称} 且 ≤10 处）
 * - 独立聚合，无关联边；use_count 由 /asset/prompt/touch 原子 $inc +1
 * - 字段名沿契约 §5.3 snake_case（=v1 列平移，与其他域 schema 同口径）
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { TemplateScene } from '../../common/enums';

@Schema({ collection: 'dl_prompt_template', versionKey: false, timestamps: false })
export class PromptTemplate {
  /** 业务主键（雪花串，服务层生成） */
  @Prop({ type: String, required: true }) template_id!: string;

  /** 标题（≤50） */
  @Prop({ type: String, required: true, maxlength: 50 }) title!: string;

  /** 话术正文（≤2000，含 {占位符}，INV-21） */
  @Prop({ type: String, required: true, maxlength: 2000 }) content!: string;

  /** 分类（编辑可清空 → 可空） */
  @Prop({ type: String, default: null }) category?: string | null;

  /** 场景：TemplateScene（WHOLE/TARGETED） */
  @Prop({ type: String, required: true, enum: Object.values(TemplateScene) })
  template_scene!: string;

  /** 使用计数（touch 原子 +1） */
  @Prop({ type: Number, required: true, default: 0, min: 0 }) use_count!: number;

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

export type PromptTemplateDocument = PromptTemplate & Document;

export const PromptTemplateSchema = SchemaFactory.createForClass(PromptTemplate);

/* 声明式索引（api-assets.md §5.3 dl_prompt_template） */
PromptTemplateSchema.index({ template_id: 1 }, { unique: true, name: 'uk_template_id' });
PromptTemplateSchema.index({ user_id: 1, template_scene: 1 }, { name: 'idx_user_scene' });
