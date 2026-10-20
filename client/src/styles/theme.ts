import { theme } from 'ant-design-vue'
import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context'

/** 外观模式：亮 / 暗 / 跟随系统（AA 附录B：客户端本地能力，不入业务架构） */
export type DlAppearanceMode = 'light' | 'dark' | 'auto'

/**
 * AntdV 4 token（frontend-specs 05 全局基调）——按外观派生。
 * 经 App.vue 的 <a-config-provider :theme> 注入。
 * 暗色用 darkAlgorithm 派生组件色板，仅锚定主色与圆角/字号；
 * 亮色保持 v1 冻结基调（背景/文字显式覆盖）。
 */
export function getDlTheme(dark: boolean): ThemeConfig {
  // 现代化基调：更大圆角 + 降噪阴影交给 darkAlgorithm 派生
  const shared = { borderRadius: 8, fontSize: 14 } as const
  return dark
    ? {
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#6b8ab5',
          // 表面色锚定 global.less 暗色板：页面底 #141414 → 表面 #1f1f1f → 浮层 #262626。
          // 不锚定时 darkAlgorithm 默认 container=#141414，组件会在 #1f1f1f 卡片上显成"更黑的洞"。
          colorBgLayout: '#141414',
          colorBgContainer: '#1f1f1f',
          colorBgElevated: '#262626',
          colorBorderSecondary: '#2c3240',
          ...shared,
        },
      }
    : {
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#6b8ab5',
          colorBgLayout: '#f4f5f7',
          colorText: '#1f2937',
          ...shared,
        },
      }
}
