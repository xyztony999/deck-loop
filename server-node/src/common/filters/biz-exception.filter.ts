import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { BizException } from '../exceptions';
import { Result } from '../result';

/** 结构化响应最小类型（不依赖 express 类型，保持 common 零平台耦合） */
interface JsonResponder {
  status(code: number): JsonResponder;
  json(body: unknown): void;
}

/**
 * 全局异常过滤器（APP_FILTER 注册）：
 * 一切异常统一转 Result JSON，HTTP 状态恒 200（v1 RestControllerAdvice 行为对齐）。
 *
 * - BizException → Result.fail(msg, BIZ_* 码)
 * - 校验失败（ValidationPipe → BadRequestException）→ 透出首条字段校验 message（v1 Advice 对齐），兜底「参数错误」
 * - 未知异常 → Result.fail('系统繁忙，请稍后再试', '500')（SYS）
 */
@Catch()
export class BizExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(BizExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponder>();
    const result = this.toResult(exception);
    response.status(HttpStatus.OK).json(result);
  }

  private toResult(exception: unknown): Result<null> {
    if (exception instanceof BizException) {
      this.logger.warn(`biz error: code=${exception.code}, msg=${exception.msg}`);
      return Result.fail(exception.msg, exception.code);
    }

    if (exception instanceof HttpException) {
      const validationMessage = this.extractValidationMessage(exception);
      if (validationMessage !== null) {
        this.logger.warn(`param validation error: ${validationMessage}`);
        return Result.fail(validationMessage);
      }
    }

    const unknown = exception instanceof Error ? exception.message : String(exception);
    this.logger.error(`unhandled error: ${unknown}`, exception instanceof Error ? exception.stack : undefined);
    return Result.fail('系统繁忙，请稍后再试');
  }

  /**
   * 仅 BadRequestException(400) 视为参数校验失败；
   * 透出首条字段校验 message，无字段信息时兜底「参数错误」。
   * 其余 HttpException 归入未知 → SYS。
   */
  private extractValidationMessage(exception: HttpException): string | null {
    if (exception.getStatus() !== HttpStatus.BAD_REQUEST) {
      return null;
    }
    const body: unknown = exception.getResponse();
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message: unknown = (body as { message?: unknown }).message;
      if (Array.isArray(message) && message.length > 0 && typeof message[0] === 'string') {
        return message[0];
      }
      if (typeof message === 'string' && message.length > 0 && message !== 'Bad Request') {
        return message;
      }
    }
    return '参数错误';
  }
}
