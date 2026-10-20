import {
  BadRequestException,
  Controller,
  Header,
  Headers,
  Query,
  Req,
  Sse,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { AUTH_SESSION_EXPIRED, AUTH_SESSION_EXPIRED_MSG, BizException } from '../common/exceptions';
import { Public } from '../common/guards/auth.guard';
import { SessionTokenService } from './session-token.service';
import { SseTaskStreamHub, type SseMessageEvent, type SseSubscription } from './gateway/sse-task-stream-hub';

/** 最小请求结构（不依赖 express 类型；监听客户端断连注销订阅） */
interface CloseableRequest {
  on(event: 'close', listener: () => void): unknown;
}

/**
 * 任务进度流接口（P-01，接口域 gw；GET /gw/task/stream，api-platform §4.4；
 * v1 GatewayStreamController 平移，Spring SseEmitter → Nest @Sse + RxJS Subject）。
 *
 * - @Public + **handler 内 query token 自证**（domain-manifest §0：EventSource 无法
 *   自定义请求头 → 守卫旁路后校验 `?token=`，X-Auth-Token 头同样接受），
 *   不得裸公开；
 * - 事件：task-progress{taskId,percent,stageText} / task-finished{taskId,taskStatus}，
 *   心跳 15s（hub 单 timer 广播）；
 * - SSE 为增强通道（D4），POST /gen/task/progress 轮询兜底；
 * - text/event-stream 响应流：X-Accel-Buffering=no 禁用反代缓冲（契约实现说明），
 *   本端点为全 POST/Result 包装约定的文档化例外；
 * - deckId 可选过滤（入参格式校验后使用，NR-04）。
 */
@Controller('gw/task')
export class GatewayStreamController {
  /** SSE 鉴权 query 参数（EventSource 限制无法携带自定义头） */
  static readonly TOKEN_PARAM = 'token';

  constructor(
    private readonly sessionTokenService: SessionTokenService,
    private readonly sseTaskStreamHub: SseTaskStreamHub,
  ) {}

  @Public()
  @Header('X-Accel-Buffering', 'no')
  @Sse('stream')
  stream(
    @Query(GatewayStreamController.TOKEN_PARAM) token?: string,
    @Query('deckId') deckId?: string,
    @Headers('x-auth-token') headerToken?: string,
    @Req() req?: CloseableRequest,
  ): Observable<SseMessageEvent> {
    // query token 优先，X-Auth-Token 头兜底（v1 行为）
    const rawToken = firstString(token) ?? firstString(headerToken);
    const payload = this.sessionTokenService.verify(rawToken ?? '');
    if (rawToken === undefined || rawToken.length === 0 || payload === null) {
      throw new BizException(AUTH_SESSION_EXPIRED, AUTH_SESSION_EXPIRED_MSG);
    }

    const normalizedDeckId = firstString(deckId);
    if (normalizedDeckId !== undefined && !/^[A-Za-z0-9_-]{1,32}$/.test(normalizedDeckId)) {
      throw new BadRequestException('参数错误');
    }

    const subscription: SseSubscription = this.sseTaskStreamHub.register(
      payload.userId,
      normalizedDeckId,
    );
    // 客户端断连 → 注销订阅（SSE 生命周期回收；hub 停机兜底）
    req?.on('close', () => this.sseTaskStreamHub.unregister(subscription.id));
    return subscription.events;
  }
}

/** query/header 单值收敛（重复参数的数组形态按首值处理，其余忽略） */
function firstString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' && first.trim().length > 0 ? first.trim() : undefined;
  }
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
