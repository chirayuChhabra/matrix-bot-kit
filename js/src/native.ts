import { createRequire } from "node:module"

type NativeMatrixBot = {
  registerSubBot(subBot: NativeSubBot): void
  subBotCount: number
}

type NativeSubBot = {
  name: string
}

export type NativeBinding = {
  MatrixBot: new (options: {
    homeserverUrl: string
    username: string
    password: string
    recoveryKey: string
    dataDir?: string
  }) => NativeMatrixBot
  SubBot: new (name: string) => NativeSubBot
}

export function loadNativeBinding(): NativeBinding | undefined {
  try {
    const require = createRequire(import.meta.url)
    return require("../native/matrix_bot_node.node") as NativeBinding
  } catch {
    return undefined
  }
}
