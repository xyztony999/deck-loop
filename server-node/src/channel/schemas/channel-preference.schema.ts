import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

/**
 * 渠道偏好聚合根（dl_channel_preference，api-channel §5.3）：
 * - 1:1 用户（每用户至多一篇文档），upsert 键=user_id（uk_user 唯一索引，INV-23）
 * - 嵌入：preference_map（{OUTLINE/FULL_GENERATE/FULL_ADJUST/TARGETED_ADJUST:{channelCode,modelCode}}，
 *   无独立生命周期值对象整体嵌入；缺省档位回落默认）
 * - 引用：default_channel_code/default_model_code 为渠道配置代码（引用服务端渠道注册
 *   env/config，非业务 id 外键；可用性校验 INV-22 由应用层守卫）
 * - 审计/data_version（$inc 乐观锁）/delete_sign（统一模板，配置型无删除路径）按 20 §3
 * - 字段命名=契约 §5.3 字段清单逐字平移（snake_case，v1 列名）
 * - _id=ObjectId 仅存储不进 VO（NR-08）；业务主键 preference_id=雪花串+唯一索引
 */

/** preference_map 档位值对象（嵌入值；契约键名 channelCode/modelCode 驼峰逐字对齐） */
export interface PreferenceTier {
  channelCode: string;
  modelCode: string;
}

/** 档位值对象 schema（Map 的 of 目标；_id 不嵌入） */
const preferenceTierSchema = new MongooseSchema(
  {
    channelCode: { type: String, required: true },
    modelCode: { type: String, required: true },
  },
  { _id: false },
);

@Schema({
  collection: 'dl_channel_preference',
  versionKey: false,
  // 空对象档位 {} 不被 minify 剔除（清除全部档位后保留显式空 map）
  minimize: false,
})
export class ChannelPreference {
  /** 业务主键（雪花串，uk_preference_id 唯一索引） */
  @Prop({ type: String, required: true, unique: true })
  preference_id!: string;

  /** 属主（唯一，upsert 键 uk_user，INV-23；隔离字段服务端注入 ADR-005/NR-05） */
  @Prop({ type: String, required: true, unique: true })
  user_id!: string;

  /** 默认渠道编码（有可用渠道时必填；INV-22 应用层守卫） */
  @Prop({ type: String })
  default_channel_code?: string | null;

  /** 默认模型编码（INV-22 应用层守卫） */
  @Prop({ type: String })
  default_model_code?: string | null;

  /** 分任务类型档位（键=TaskType code；Map<string, PreferenceTier> 整体嵌入） */
  @Prop({ type: Map, of: preferenceTierSchema })
  preference_map?: Map<string, PreferenceTier>;

  /** 乐观锁版本号（$inc 平移，20 §3） */
  @Prop({ type: Number, default: 0 })
  data_version!: number;

  /** 逻辑删除：0-未删除（统一模板保留；配置型主数据无删除路径） */
  @Prop({ type: Number, default: 0 })
  delete_sign!: number;

  @Prop({ type: String })
  created_by?: string | null;

  @Prop({ type: String })
  created_name?: string | null;

  @Prop({ type: Date })
  created_time?: Date | null;

  @Prop({ type: String })
  updated_by?: string | null;

  @Prop({ type: String })
  updated_name?: string | null;

  @Prop({ type: Date })
  updated_time?: Date | null;
}

export type ChannelPreferenceDocument = HydratedDocument<ChannelPreference>;

export const ChannelPreferenceSchema = SchemaFactory.createForClass(ChannelPreference);

/**
 * lean 读取形态：Map schema 在 lean() 下为普通对象（BSON 原貌），仓储据此转纯快照。
 */
export interface ChannelPreferenceLean extends Omit<ChannelPreference, 'preference_map'> {
  preference_map?: Record<string, PreferenceTier> | null;
}
