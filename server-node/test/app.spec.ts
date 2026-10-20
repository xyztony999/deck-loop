import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { ArgumentsHost, INestApplicationContext } from '@nestjs/common';
import { EventEmitter2 } from 'eventemitter2';
import type { Connection } from 'mongoose';
import { AppModule } from '../src/app.module';
import { AUTH_SESSION_EXPIRED, BizException } from '../src/common/exceptions';
import { BizExceptionFilter } from '../src/common/filters/biz-exception.filter';
import { AuthGuard, Public } from '../src/common/guards/auth.guard';
import type { AuthPrincipal, AuthTokenVerifier } from '../src/common/auth-token-verifier';
import { OperItem, PageResult, Result, SelectOption } from '../src/common/result';
import { Snowflake, nextId } from '../src/common/utils/snowflake';

describe('deck-loop v3 skeleton（AppModule 装配）', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    // NestJS 10 形态：compile() 返回 TestingModule（即 INestApplicationContext）
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
  });

  afterAll(async () => {
    await app.close();
  });

  it('mongodb-memory-server 共享实例已就绪（env 继承）', () => {
    expect(process.env.MONGODB_URI).toMatch(/^mongodb:\/\//);
  });

  it('Mongoose 默认连接可达（readyState=1）', async () => {
    const connection = app.get<Connection>(getConnectionToken());
    await connection.asPromise();
    expect(connection.readyState).toBe(1);
  });

  it('EventEmitter2 全局装配（@OnEvent 事件总线可用）', () => {
    const emitter = app.get<EventEmitter2>(EventEmitter2);
    expect(emitter).toBeInstanceOf(EventEmitter2);
  });

  it('全局 AuthGuard 行为：@Public 跳过 / 未提供 verifier → 会话过期 BizException', () => {
    const guard = new AuthGuard(new Reflector(), null);

    class PublicFixture {
      @Public()
      handler(): void {}
    }
    class ProtectedFixture {
      handler(): void {}
    }

    // ExecutionContext/请求 stub（结构化最小类型，unknown 转换：测试替身非真实框架对象）
    const makeContext = (
      handler: () => void,
      clazz: unknown,
      headers: Record<string, string | string[] | undefined>,
    ): ExecutionContext =>
      ({
        getHandler: () => handler,
        getClass: () => clazz,
        switchToHttp: () => ({ getRequest: () => ({ headers }) }),
      }) as unknown as ExecutionContext;

    // @Public() 跳过认证
    expect(
      guard.canActivate(makeContext(PublicFixture.prototype.handler, PublicFixture, {})),
    ).toBe(true);

    // 未提供 verifier（platform 域未挂载时）→ BIZ_AUTH_SESSION_EXPIRED
    expect(() =>
      guard.canActivate(
        makeContext(ProtectedFixture.prototype.handler, ProtectedFixture, {
          'x-auth-token': 't0',
        }),
      ),
    ).toThrow(BizException);
    try {
      guard.canActivate(
        makeContext(ProtectedFixture.prototype.handler, ProtectedFixture, {
          'x-auth-token': 't0',
        }),
      );
      fail('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BizException);
      expect((error as BizException).code).toBe(AUTH_SESSION_EXPIRED);
    }

    // verifier 校验失败 → 同码；成功 → request.user = {userId, accountId}
    const okVerifier: AuthTokenVerifier = {
      verify: (token: string) => (token === 'good' ? { userId: 'u1', accountId: 'acc1' } : null),
    };
    const guardWithVerifier = new AuthGuard(new Reflector(), okVerifier);
    let principal: AuthPrincipal | undefined;
    const badCtx = {
      getHandler: () => ProtectedFixture.prototype.handler,
      getClass: () => ProtectedFixture,
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { 'x-auth-token': 'bad' },
          get user() {
            return principal;
          },
          set user(v: AuthPrincipal | undefined) {
            principal = v;
          },
        }),
      }),
    } as unknown as ExecutionContext;
    expect(() => guardWithVerifier.canActivate(badCtx)).toThrow(BizException);

    const goodCtx = {
      getHandler: () => ProtectedFixture.prototype.handler,
      getClass: () => ProtectedFixture,
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { 'x-auth-token': 'good' },
          get user() {
            return principal;
          },
          set user(v: AuthPrincipal | undefined) {
            principal = v;
          },
        }),
      }),
    } as unknown as ExecutionContext;
    expect(guardWithVerifier.canActivate(goodCtx)).toBe(true);
    expect(principal).toEqual({ userId: 'u1', accountId: 'acc1' });
  });

  it('BizExceptionFilter 行为：业务码/校验消息/未知异常 → Result（HTTP 200）', () => {
    const filter = new BizExceptionFilter();
    let statusCode = 0;
    let body: unknown;
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({
          status(code: number) {
            statusCode = code;
            return this;
          },
          json(payload: unknown) {
            body = payload;
          },
        }),
      }),
    } as unknown as ArgumentsHost;

    // BizException → code=BIZ_*
    filter.catch(new BizException('BIZ_ASSET_NAME_DUP', '名称重复'), host);
    expect(statusCode).toBe(200);
    expect(body).toMatchObject({ status: false, code: 'BIZ_ASSET_NAME_DUP', msg: '名称重复' });

    // 校验失败（ValidationPipe → BadRequestException）→ 透出首条字段 message
    filter.catch(new BadRequestException(['邮箱格式不正确', '密码过短']), host);
    expect(statusCode).toBe(200);
    expect(body).toMatchObject({ status: false, code: '500', msg: '邮箱格式不正确' });

    // 未知异常 → SYS（500 兜底）
    filter.catch(new Error('boom'), host);
    expect(statusCode).toBe(200);
    expect(body).toMatchObject({ status: false, code: '500' });
  });

  it('Result/PageResult 工厂对齐 v1 契约字段', () => {
    const ok = Result.success({ id: 'x1' });
    expect(ok.status).toBe(true);
    expect(ok.code).toBe('0');
    expect(ok.msg).toBe('success');
    expect(ok.data).toEqual({ id: 'x1' });
    expect(typeof ok.timestamp).toBe('number');

    const okEmpty = Result.success();
    expect(okEmpty.status).toBe(true);
    expect(okEmpty.data).toBeNull();

    const fail = Result.fail('boom');
    expect(fail.status).toBe(false);
    expect(fail.code).toBe('500');
    expect(fail.msg).toBe('boom');
    expect(fail.data).toBeNull();

    const bizFail = Result.fail('重复邮箱', 'BIZ_AUTH_EMAIL_EXISTS');
    expect(bizFail.code).toBe('BIZ_AUTH_EMAIL_EXISTS');

    const page = PageResult.of([1, 2], 2, 1, 20);
    expect(page).toEqual({ records: [1, 2], total: 2, pageNum: 1, pageSize: 20 });

    expect(SelectOption.of('a', 'A牌')).toEqual({ value: 'a', label: 'A牌' });
    expect(OperItem.of('delete', '删除', 'danger')).toEqual({
      code: 'delete',
      label: '删除',
      style: 'danger',
    });
  });

  it('BizException 携带 BIZ_* 业务码', () => {
    const e = new BizException(AUTH_SESSION_EXPIRED, '会话已过期，请重新登录');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('BIZ_AUTH_SESSION_EXPIRED');
    expect(e.msg).toBe('会话已过期，请重新登录');
  });

  it('雪花 id：string 输出、进程内单例不重号', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const id = nextId();
      expect(id).toMatch(/^\d+$/);
      ids.add(id);
    }
    expect(ids.size).toBe(2000);
    expect(nextId()).not.toBe(nextId());
  });

  it('Snowflake workerId 越界拒绝', () => {
    expect(() => new Snowflake(1024n)).toThrow(RangeError);
    expect(() => new Snowflake(-1n)).toThrow(RangeError);
  });
});
