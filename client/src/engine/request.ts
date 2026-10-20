/**
 * 统一 HTTP 请求层（frontend-specs 02-mandatory 规则 1/8 的 deck-loop 等价实现）。
 *
 * - baseURL '/api'：业务代码 URL 一律不含 /api 前缀，由 vite 代理（dev）/
 *   Tauri 资源层承担前缀剥离（规则 8）。
 * - 响应拦截统一解包 Result{status,code,msg,data}：成功返回 data，
 *   失败 message.error + reject。
 * - 401 / 会话失效（BIZ_AUTH_SESSION_EXPIRED）→ 经 authBridge 回调清态回登录页。
 * - 禁止业务代码直接 import axios 或绕过本模块发请求。
 */
import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { message } from 'ant-design-vue'

import type { Result } from './types'

/** 会话过期错误码（api-platform.md P-02） */
export const CODE_SESSION_EXPIRED = 'BIZ_AUTH_SESSION_EXPIRED'

/** HTTP 401 */
export const HTTP_UNAUTHORIZED = 401

/**
 * 认证桥：request.ts 不直接依赖 pinia store（避免循环引用与
 * 「getActivePinia called with no active Pinia」初始化问题），
 * 由 main.ts 在应用装配时注入。
 */
export interface AuthBridge {
  /** 返回当前 token，注入 X-Auth-Token 请求头 */
  getToken: () => string | null
  /** 401 / 会话失效回调（清态并跳转 /auth），由 auth store 提供 */
  onUnauthorized: (reason: string) => void
}

let authBridge: AuthBridge | null = null

/** 注册认证桥（main.ts 装配时调用一次） */
export function setAuthBridge(bridge: AuthBridge): void {
  authBridge = bridge
}

function handleUnauthorized(reason: string): void {
  if (authBridge) {
    authBridge.onUnauthorized(reason)
  }
}

const instance: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
})

// 请求拦截：注入 X-Auth-Token（后端 AccountController.TOKEN_HEADER）
instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = authBridge?.getToken()
  if (token) {
    config.headers.set('X-Auth-Token', token)
  }
  return config
})

// 响应拦截：统一解包 Result
instance.interceptors.response.use(
  (response: AxiosResponse) => {
    // 非标准信封（如文件流）直接透传，由调用方处理
    const envelope = response.data as Partial<Result> | undefined
    if (
      envelope == null ||
      typeof envelope !== 'object' ||
      typeof envelope.status !== 'boolean'
    ) {
      return response
    }

    if (envelope.status) {
      // 解包：下游拿到的是 data 本体
      response.data = envelope.data
      return response
    }

    // 业务失败
    if (envelope.code === CODE_SESSION_EXPIRED) {
      handleUnauthorized(envelope.msg || '会话已过期')
      return Promise.reject(
        Object.assign(new Error(envelope.msg || '会话已过期'), {
          code: envelope.code,
          biz: true,
        }),
      )
    }

    message.error(envelope.msg || '操作失败')
    return Promise.reject(
      Object.assign(new Error(envelope.msg || '操作失败'), {
        code: envelope.code,
        biz: true,
      }),
    )
  },
  (error: AxiosError<Result>) => {
    const status = error.response?.status
    const msg =
      error.response?.data?.msg || error.message || '网络异常，请稍后重试'

    if (status === HTTP_UNAUTHORIZED) {
      handleUnauthorized(msg)
    } else {
      message.error(msg)
    }

    return Promise.reject(
      Object.assign(new Error(msg), {
        code: error.response?.data?.code ?? String(status ?? 'NETWORK_ERROR'),
        biz: status === undefined,
      }),
    )
  },
)

/**
 * POST 请求（业务接口统一 POST，规约 §4.3）。
 * 返回已解包的 data。
 */
export async function post<T = unknown>(
  url: string,
  data?: Record<string, unknown>,
): Promise<T> {
  const resp = await instance.post<T>(url, data)
  return resp.data
}

/**
 * POST multipart 上传通道（素材上传等 FormData 场景）。
 *
 * - URL 仍以 action 注册表为唯一来源：调用方经 getAction('asset.assetUpload')
 *   取 path 后传入（actionExecutor 的 JSON 通道不适合 FormData）；
 * - instance 默认 Content-Type=application/json 会让 axios 把 FormData
 *   JSON 序列化，postForm 以 multipart/form-data 头覆盖后，浏览器适配器
 *   自行移除该头并补边界（axios FormData 标准行为）；
 * - 认证头注入 / Result 解包 / 401 处理与 post() 完全一致。
 */
export async function postForm<T = unknown>(
  url: string,
  form: FormData,
): Promise<T> {
  const resp = await instance.postForm<T>(url, form)
  return resp.data
}

/** GET 请求（仅文件下载等场景） */
export async function get<T = unknown>(
  url: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const resp = await instance.get<T>(url, { params })
  return resp.data
}

/** axios 原始实例（仅引擎内部 / 下载等特殊场景使用，业务代码禁用） */
export function rawAxios(): AxiosInstance {
  return instance
}
