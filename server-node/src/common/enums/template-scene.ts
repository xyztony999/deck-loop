/**
 * 业务枚举 TemplateScene —— 池来源：workspace/01-solution/common-spec/04-business-enum.md「TemplateScene」
 * 使用对象：dl_prompt_template.template_scene（api-assets，S-02 话术库）。
 * 契约冻结：code 值与枚举池逐字一致（node-specs 20 §6）。
 */
export const TemplateScene = {
  /** 整稿场景 */
  WHOLE: 'WHOLE',
  /** 定向场景 */
  TARGETED: 'TARGETED',
} as const;

export type TemplateSceneCode = (typeof TemplateScene)[keyof typeof TemplateScene];

const TEMPLATE_SCENE_LABELS: Record<TemplateSceneCode, string> = {
  [TemplateScene.WHOLE]: '整稿场景',
  [TemplateScene.TARGETED]: '定向场景',
};

/** code → 中文标签（未匹配时回显 code 本身） */
export function getTemplateSceneLabel(code: string): string {
  return TEMPLATE_SCENE_LABELS[code as TemplateSceneCode] ?? code;
}
