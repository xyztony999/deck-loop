/**
 * action 注册汇总（应用装配时由 main.ts 引入一次）。
 *
 * ADR-018 退役面：generation（gen）/adjustment（adjust）/channel 模块整体移除，
 * 不再注册；ver 域独立成 version.ts；auth 域增个人 token 三端点。
 */
import { registerModule } from '@/engine/actionExecutor'
import { dictModule } from './dict'
import { authModule } from './auth'
import { deckModule } from './deck'
import { verModule } from './version'
import { assetModule } from './assets'
import { deliverModule } from './delivery'

export function registerAllActions(): void {
  registerModule(dictModule)
  registerModule(authModule)
  registerModule(deckModule)
  registerModule(verModule)
  registerModule(assetModule)
  registerModule(deliverModule)
}

export {
  dictModule,
  authModule,
  deckModule,
  verModule,
  assetModule,
  deliverModule,
}