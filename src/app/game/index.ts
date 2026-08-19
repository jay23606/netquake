import {init} from '../../engine/sys'
import * as AppSys from './sys'
import { InitArgs, UIHooks } from './sys'

export default async (args: string, hooks: UIHooks, initArgs: InitArgs) => {
  AppSys.registerHooks(hooks)
  AppSys.state.initArgs = initArgs
  await init(args, AppSys)
  return AppSys
} 