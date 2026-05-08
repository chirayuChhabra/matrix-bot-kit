import { createRequire } from "node:module"

type NativeMatrixBot = {
  start(
    options: NativeListenOptions,
    onMessage: (message: NativeIncomingMessage) => void,
    onLog: (event: NativeRuntimeLog) => void,
  ): void
  sendText(roomId: string, body: string): Promise<void>
  sendMarkdown(roomId: string, body: string): Promise<void>
  sendImage(roomId: string, attachment: NativeMediaAttachment): Promise<void>
  sendFile(roomId: string, attachment: NativeMediaAttachment): Promise<void>
  sendVideo(roomId: string, attachment: NativeMediaAttachment): Promise<void>
  sendPoll(roomId: string, poll: NativePoll): Promise<void>
  replyText(roomId: string, eventId: string, body: string): Promise<void>
  replyMarkdown(roomId: string, eventId: string, body: string): Promise<void>
  downloadMedia(roomId: string, eventId: string): Promise<Buffer>
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
  messageType: MatrixMessageType
  body: string
  media?: NativeMediaMessage
  poll?: NativePollMessage
  repliedMessage?: {
    eventId: string
    sender: string
    messageType: MatrixMessageType
    body: string
    media?: NativeMediaMessage
  }
  replyUnsupported: boolean
}

export type NativeRuntimeLog = {
  level: "debug" | "info" | "warn" | "error"
  message: string
}

export type MatrixMessageType =
  | "text"
  | "notice"
  | "server_notice"
  | "image"
  | "file"
  | "video"
  | "poll"

export type NativeMediaMessage = {
  kind: "image" | "file" | "video"
  filename: string
  caption?: string
  mxcUri?: string
  mimetype?: string
  size?: number
  width?: number
  height?: number
  durationMs?: number
  encrypted: boolean
}

export type NativePollMessage = {
  question: string
  kind: string
  maxSelections: number
  answers: NativePollAnswer[]
}

export type NativePollAnswer = {
  id: string
  text: string
}

export type NativeMediaAttachment = {
  filename: string
  contentType: string
  data: Buffer | Uint8Array
}

export type NativePoll = {
  question: string
  answers: NativePollAnswer[]
}

export type NativeBinding = {
  MatrixBot: new (options: {
    homeserverUrl: string
    username: string
    password: string
    recoveryKey: string
    dataDir?: string
  }) => NativeMatrixBot
  SubBot: new (name: string, commands?: string[]) => NativeSubBot
}

export function loadNativeBinding(): NativeBinding | undefined {
  try {
    const require = createRequire(import.meta.url)
    return require("../native/matrix_bot_node.node") as NativeBinding
  } catch {
    return undefined
  }
}
