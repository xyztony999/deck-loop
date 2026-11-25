/**
 * Action 执行器（frontend-specs §4.3 actions 规范的 deck-loop 等价实现）。
 *
 * 所有页面请求只经本执行器；action 定义由 src/api/actions/{module}.ts
 * 注册（URL 来自 PageSpec，禁止编造，规则 2）。
 *
 * 用法：
 *   // src/api/actions/deck.ts
 *   export const deckModule = defineModule('deck', {
 *     'deck.deckList':  { method: 'POST', path: '/deck/deck/list',  type: 'list' },
 *     'deck.deckSave':  { method: 'POST', path: '/deck/deck/save',  type: 'save' },
 *   })
 *   registerModule(deckModule)          // 应用装配时（api/actions/index.ts）
 *   await executeAction<PageResult<DeckListVO>>('deck.deckList', query)
 */
import { get, post } from './request'
import type { ActionDef, ActionType } from './types'

/** 未带 key 的动作形态（defineModule 内部会补齐 `{module}.{name}`） */
export type ActionDefInput = Omit<ActionDef, 'key'>

/** 一个业务模块的全部动作（键为完整 action key） */
export type ActionRegistry = Map<string, ActionDef>

/** defineModule 返回的可注册模块 */
export interface ActionModule {
  name: string
  actions: Record<string, ActionDef>
}

const registry: ActionRegistry = new Map()

/** 包装并命名一个模块的动作集合（键名自动加 `{module}.` 前缀） */
export function defineModule(
  name: string,
  actions: Record<string, ActionDefInput>,
): ActionModule {
  const full: Record<string, ActionDef> = {}
  for (const [key, def] of Object.entries(actions)) {
    const fullKey = key.startsWith(`${name}.`) ? key : `${name}.${key}`
    if (registry.has(fullKey)) {
      // 重复注册视为编码事故：同 key 不同定义会静默串接口
      throw new Error(`[actionExecutor] action 重复注册: ${fullKey}`)
    }
    full[fullKey] = { ...def, key: fullKey }
  }
  return { name, actions: full }
}

/** 注册模块（幂等：同名模块重复注册会被拒绝） */
export function registerModule(module: ActionModule): void {
  for (const [key, def] of Object.entries(module.actions)) {
    if (registry.has(key)) {
      throw new Error(`[actionExecutor] action 重复注册: ${key}`)
    }
    registry.set(key, def)
  }
}

/** 注册单个动作（少用；优先 defineModule） */
export function registerAction(def: ActionDef): void {
  if (registry.has(def.key)) {
    throw new Error(`[actionExecutor] action 重复注册: ${def.key}`)
  }
  registry.set(def.key, def)
}

export function hasAction(key: string): boolean {
  return registry.has(key)
}

export function getAction(key: string): ActionDef | undefined {
  return registry.get(key)
}

/** 调试/测试用：导出全部已注册 action key */
export function listActionKeys(): string[] {
  return [...registry.keys()]
}

export interface ExecuteOptions {
  /** URL `{占位符}` 替换参数，如 {deckId} */
  pathParams?: Record<string, string | number>
}

/**
 * 执行一个已注册的 action，返回解包后的 data。
 *
 * @param key    action key（须已注册），也接受内联 ActionDef（引擎内部使用）
 * @param payload 请求体（POST）或查询参数（GET）
 */
export async function executeAction<T = unknown>(
  key: string | ActionDef,
  payload?: Record<string, unknown>,
  options?: ExecuteOptions,
): Promise<T> {
  const def: ActionDef | undefined =
    typeof key === 'string' ? registry.get(key) : key
  if (!def) {
    throw new Error(
      `[actionExecutor] 未注册的 action: ${typeof key === 'string' ? key : key.key}（检查 src/api/actions/ 是否已注册并在 index.ts 汇总）`,
    )
  }

  let url = def.path
  if (options?.pathParams) {
    for (const [name, value] of Object.entries(options.pathParams)) {
      url = url.replaceAll(`{${name}}`, encodeURIComponent(String(value)))
    }
  }

  if (def.method === 'GET') {
    return get<T>(url, payload)
  }
  return post<T>(url, payload)
}

/** 执行器单例句柄（对齐参考实现的 getActionExecutor() 形态） */
export const actionExecutor = {
  defineModule,
  registerModule,
  registerAction,
  has: hasAction,
  get: getAction,
  keys: listActionKeys,
  execute: executeAction,
}

export function getActionExecutor(): typeof actionExecutor {
  return actionExecutor
}

export type { ActionDef, ActionType }
