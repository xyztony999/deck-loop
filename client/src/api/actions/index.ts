/**
 * action 注册汇总（应用装配时由 main.ts 引入一次）。
 *
 * F2-F4 新增模块：在对应 api/actions/{domain}.ts 定义后，在此 import 并
 * 加入 registerAll 的数组即可。
 */
import { registerModule } from '@/engine/actionExecutor'
import { dictModule } from './dict'
import { authModule } from './auth'
import { genModule } from './gen'
import { deckModule } from './deck'
import { adjustModule, verModule } from './adjustment'
import { channelModule } from './settings'
import { assetModule } from './assets'
import { deliverModule } from './delivery'

export function registerAllActions(): void {
  registerModule(dictModule)
  registerModule(authModule)
  registerModule(genModule)
  registerModule(deckModule)
  registerModule(adjustModule)
  registerModule(verModule)
  registerModule(channelModule)
  registerModule(assetModule)
  registerModule(deliverModule)
}

export {
  dictModule,
  authModule,
  genModule,
  deckModule,
  adjustModule,
  verModule,
  channelModule,
  assetModule,
  deliverModule,
}
