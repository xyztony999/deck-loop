import { theme } from 'ant-design-vue'
import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context'

/** 外观模式：亮 / 暗 / 跟随系统（AA 附录B：客户端本地能力，不入业务架构） */
export type DlAppearanceMode = 'light' | 'dark' | 'auto'

/**
 * AntdV 4 token（07-ui-design-language.md v2.0）——按外观派生。
 * 经 App.vue 的 <a-config-provider :theme> 注入。
 * 暗色用 darkAlgorithm 派生组件色板，锚定三层色板与主色；
 * 表格 token（表头透明坐表面）对全部表格生效，engine 内 .dl-table 再做密度覆写。
 */
export function getDlTheme(dark: boolean): ThemeConfig {
  const shared = { borderRadius: 8, fontSize: 14 } as const
  const components = {
    Table: {
      // 07 §7：表头透明坐表面、次要色 12px；单元格密度由 .dl-table 覆写
      headerBg: 'transparent',
      headerColor: dark ? '#a6adb8' : '#6b7280',
      headerSplitColor: 'transparent',
      rowHoverBg: dark ? '#2a2a2a' : '#f5f5f5',
    },
    Pagination: {
      // 页脚行小号分页（07 §3.2）
      itemSize: 24,
    },
  } as const
  return dark
    ? {
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#6b8ab5',
          // 表面色锚定 global.less 暗色板：页面底 #141414 → 表面 #1f1f1f → 浮层 #262626。
          // 不锚定时 darkAlgorithm 默认 container=#141414，组件会在 #1f1f1f 表面上显成"更黑的洞"。
          colorBgLayout: '#141414',
          colorBgContainer: '#1f1f1f',
          colorBgElevated: '#262626',
          colorBorderSecondary: '#2c3240',
          ...shared,
        },
        components,
      }
    : {
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#6b8ab5',
          colorBgLayout: '#f4f5f7',
          colorText: '#1f2937',
          ...shared,
        },
        components,
      }
}
