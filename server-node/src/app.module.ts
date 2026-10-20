import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';
import { AdjustmentModule } from './adjustment/adjustment.module';
import { AssetModule } from './asset/asset.module';
import { ChannelModule } from './channel/channel.module';
import { DeckModule } from './deck/deck.module';
import { DeliverModule } from './deliver/deliver.module';
import { GenerationModule } from './generation/generation.module';
import { BizExceptionFilter } from './common/filters/biz-exception.filter';
import { AuthGuard } from './common/guards/auth.guard';
import { PlatformModule } from './platform/platform.module';
import { VersionModule } from './version/version.module';

/** env 直读（不引 config 包）；默认本地 deck_loop 库 */
const DEFAULT_MONGODB_URI = 'mongodb://127.0.0.1:27017/deck_loop';

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGODB_URI ?? DEFAULT_MONGODB_URI),
    // 进程内事件（EventEmitter2，事件名=契约 businessType，事务提交后发布）
    EventEmitterModule.forRoot(),
    // 业务域模块（T01' 占位挂载；域代理在此填充 controller/service/repository/schema——
    // 八域：deck/generation/adjustment/version/deliver/asset/channel/platform，协调见 domain-manifest.md）
    DeckModule,
    GenerationModule,
    AdjustmentModule,
    VersionModule,
    DeliverModule,
    AssetModule,
    ChannelModule,
    PlatformModule,
  ],
  providers: [
    // 全局异常过滤器：一切异常 → Result{status,code,msg,data,timestamp}（HTTP 200，v1 对齐）
    { provide: APP_FILTER, useClass: BizExceptionFilter },
    // 全局认证守卫：X-Auth-Token 校验；@Public() 跳过（登录/注册/SSE/下载票据端点）
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
