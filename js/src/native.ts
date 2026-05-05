import { createRequire } from "node:module"

type NativeMatrixBot = {
  start(options: NativeListenOptions, onMessage: (message: NativeIncomingMessage) => void): void
  sendText(roomId: string, body: string): Promise<void>
  sendMarkdown(roomId: string, body: string): Promise<void>
  replyText(roomId: string, eventId: string, body: string): Promise<void>
  replyMarkdown(roomId: string, eventId: string, body: string): Promise<void>
  registerSubBot(subBot: NativeSubBot): void
  subBotCount: number
}

type NativeSubBot = {
  name: string
}

export type NativeListenOptions = {
  owners: string[]
  timelineLimit?: number
}

export type NativeIncomingMessage = {
  eventId: string
  roomId: string
  sender: string
  body: string
  repliedMessage?: {
    eventId: string
    sender: string
    body: string
  }
  replyUnsupported: boolean
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
