import { readFile, writeFile } from "node:fs/promises"
import { basename, extname } from "node:path"
import {
  loadNativeBinding,
  type MatrixMessageType,
  type NativeIncomingMessage,
  type NativeMediaAttachment,
} from "./native"

export type MatrixBotOptions = {
  homeserverUrl: string
  username: string
  password: string
  recoveryKey: string
  dataDir?: string
  config?: MatrixBotRuntimeConfig
  logger?: MatrixLogger
  onError?: MatrixErrorHandler
}

export type MatrixBotRuntimeConfig = {
  announceSubBotUsage?: boolean
  selfDocumentation?: boolean
  documentationPath?: string
}

type ResolvedMatrixBotRuntimeConfig = {
  announceSubBotUsage: boolean
  selfDocumentation: boolean
  documentationPath: string
}

export type ListenOptions = {
  owners: string[]
  timelineLimit?: number
}

export type MatrixRequest = {
  eventId: string
  roomId: string
  sender: string
  messageType: MatrixMessageType
  rawBody: string
  body: string
  media?: MediaMessage
  poll?: PollMessage
  repliedMessage?: RepliedMessage
  replyUnsupported: boolean
}

export type MatrixResponse = {
  sendText(body: string): Promise<void>
  sendMarkdown(body: string): Promise<void>
  sendMedia(kind: MediaKind, attachment: MediaAttachment): Promise<void>
  sendImage(attachment: MediaAttachment): Promise<void>
  sendFile(attachment: MediaAttachment): Promise<void>
  sendVideo(attachment: MediaAttachment): Promise<void>
  sendPoll(poll: OutboundPoll): Promise<void>
  replyText(body: string): Promise<void>
  replyMarkdown(body: string): Promise<void>
  downloadMedia(target?: MediaDownloadTarget): Promise<Buffer>
}

export type MediaMessage = {
  kind: MediaKind
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

export type MediaDownloadTarget = string | {
  roomId?: string
  eventId?: string
}

export type MediaKind = "image" | "file" | "video"

export type MediaAttachment = string | MediaPathAttachment | MediaDataAttachment

export type MediaPathAttachment = {
  path: string
  filename?: string
  contentType?: string
}

export type MediaDataAttachment = {
  filename: string
  contentType: string
  data: Buffer | Uint8Array
}

export type PollMessage = {
  question: string
  kind: string
  maxSelections: number
  answers: PollAnswer[]
}

export type OutboundPoll = {
  question: string
  answers: PollAnswer[]
}

export type PollAnswer = {
  id: string
  text: string
}

export type RepliedMessage = {
  eventId: string
  sender: string
  messageType: MatrixMessageType
  body: string
  media?: MediaMessage
}

export type MatrixLogLevel = "debug" | "info" | "warn" | "error"

export type MatrixLogEvent = {
  level: MatrixLogLevel
  message: string
  component: "sdk" | "runtime" | "dispatch"
  eventId?: string
  roomId?: string
  sender?: string
  subBot?: string
  documentationPath?: string
  handled?: number
  durationMs?: number
  error?: string
}

export type MatrixLogger = (event: MatrixLogEvent) => void

export type MatrixErrorContext = {
  error: unknown
  phase: "dispatch" | "runtime"
  request?: MatrixRequest
}

export type MatrixErrorHandler = (
  context: MatrixErrorContext,
) => Promise<void> | void

export type Next = () => Promise<void>
export type Middleware = (
  req: MatrixRequest,
  res: MatrixResponse,
  next: Next,
) => Promise<void> | void
export type Handler = (req: MatrixRequest, res: MatrixResponse) => Promise<void> | void

export type SubBotConfig = Record<string, unknown>

export type SubBotOptions<TConfig extends SubBotConfig = SubBotConfig> = {
  name: string
  command: string | string[]
  commands?: string | string[]
  description?: string
  category?: string
  adminOnly?: boolean
  config?: TConfig
}

export type MicroBotConfig = Record<string, unknown>

export type MicroBotOptions<TConfig extends MicroBotConfig = MicroBotConfig> = {
  name: string
  command: string | string[]
  commands?: string | string[]
  description?: string
  adminOnly?: boolean
  config?: TConfig
}

export class MatrixBot {
  readonly options: MatrixBotOptions
  readonly subBots: SubBot[] = []
  private readonly native
  private readonly logger: MatrixLogger
  private readonly errorHandler: MatrixErrorHandler
  private readonly config: ResolvedMatrixBotRuntimeConfig

  constructor(options: MatrixBotOptions) {
    assertPresent("homeserverUrl", options.homeserverUrl)
    assertPresent("username", options.username)
    assertPresent("password", options.password)
    assertPresent("recoveryKey", options.recoveryKey)
    this.options = { ...options }
    this.logger = options.logger ?? defaultLogger
    this.errorHandler = options.onError ?? this.defaultErrorHandler.bind(this)
    this.config = resolveMatrixBotConfig(options.config)
    this.native = nativeBinding
      ? new nativeBinding.MatrixBot(toNativeOptions(this.options))
      : undefined
  }

  use(subBot: SubBot): this {
    if (this.subBots.some((existing) => existing.name === subBot.name)) {
      throw new Error(`a sub-bot named \`${subBot.name}\` is already registered`)
    }

    const duplicateCommand = firstSharedValue(
      this.subBots.flatMap((existing) => existing.commands),
      subBot.commands,
    )
    if (duplicateCommand) {
      throw new Error(
        `command \`${duplicateCommand}\` is already registered by another sub-bot`,
      )
    }

    this.subBots.push(subBot)
    if (this.native && subBot.native) {
      this.native.registerSubBot(subBot.native)
    }
    return this
  }

  get nativeAvailable(): boolean {
    return this.native !== undefined
  }

  get subBotCount(): number {
    return this.native?.subBotCount ?? this.subBots.length
  }

  async dispatch(req: MatrixRequest, res: MatrixResponse): Promise<number> {
    const started = Date.now()
    let handled = 0
    try {
      for (const subBot of this.subBots) {
        if (subBot.willHandle(req)) {
          await this.sendSubBotUsageNotice(subBot, req, res)
        }
        handled += await subBot.dispatch(req, res)
      }
    } catch (error) {
      await this.handleError({ error, phase: "dispatch", request: req })
      return handled
    }

    this.log(handled > 0 ? "info" : "debug", "Matrix message dispatched", {
      eventId: req.eventId,
      roomId: req.roomId,
      sender: req.sender,
      handled,
      durationMs: Date.now() - started,
      component: "dispatch",
    })
    return handled
  }

  private async sendSubBotUsageNotice(
    subBot: SubBot,
    req: MatrixRequest,
    res: MatrixResponse,
  ): Promise<void> {
    if (!this.config.announceSubBotUsage) {
      return
    }

    try {
      await res.sendMarkdown(`> using ${subBot.name}...`)
      this.log("info", "Sub-bot usage announced", {
        component: "dispatch",
        eventId: req.eventId,
        roomId: req.roomId,
        sender: req.sender,
        subBot: subBot.name,
      })
    } catch (error) {
      this.log("warn", "Failed to announce sub-bot usage", {
        component: "dispatch",
        eventId: req.eventId,
        roomId: req.roomId,
        sender: req.sender,
        subBot: subBot.name,
        error: errorToString(error),
      })
    }
  }

  async listen(options: ListenOptions): Promise<void> {
    if (!options.owners.some((owner) => owner.trim().length > 0)) {
      throw new Error("owners is required")
    }

    if (!this.native) {
      const error = new Error(
        "native Matrix runtime binding is missing; run `devbox run build-native` first",
      )
      await this.handleError({ error, phase: "runtime" })
      throw error
    }

    this.log("info", "Starting Matrix bot runtime", {
      component: "runtime",
    })

    await this.writeConfiguredSelfDocumentation()

    this.native.start(
      {
        owners: options.owners,
        timelineLimit: options.timelineLimit,
      },
      (message) => {
        this.dispatch(
          this.requestFromNative(message),
          this.responseFromNative(message),
        ).catch((error) => {
          void this.handleError({ error, phase: "dispatch" })
        })
      },
      (event) => {
        this.log(event.level, event.message, {
          component: "runtime",
        })
      },
    )

    this.log("info", "Matrix bot runtime started", {
      component: "runtime",
    })

    await new Promise<void>(() => {})
  }

  async downloadMedia(roomId: string, eventId: string): Promise<Buffer> {
    if (!this.native) {
      throw new Error("native Matrix runtime binding is missing")
    }

    return this.native.downloadMedia(roomId, eventId)
  }

  generateSelfDocumentation(): string {
    return generateBotDocumentation(this)
  }

  async writeSelfDocumentation(path = this.config.documentationPath): Promise<string> {
    await writeFile(path, this.generateSelfDocumentation(), "utf8")
    this.log("info", "Matrix bot self-documentation written", {
      component: "sdk",
      documentationPath: path,
    })
    return path
  }

  private async writeConfiguredSelfDocumentation(): Promise<void> {
    if (!this.config.selfDocumentation) {
      return
    }

    await this.writeSelfDocumentation()
  }

  private requestFromNative(message: NativeIncomingMessage): MatrixRequest {
    return {
      eventId: message.eventId,
      roomId: message.roomId,
      sender: message.sender,
      messageType: message.messageType,
      rawBody: message.body,
      body: message.body,
      media: message.media
        ? {
            kind: message.media.kind,
            filename: message.media.filename,
            caption: message.media.caption,
            mxcUri: message.media.mxcUri,
            mimetype: message.media.mimetype,
            size: optionalNumber(message.media.size),
            width: optionalNumber(message.media.width),
            height: optionalNumber(message.media.height),
            durationMs: optionalNumber(message.media.durationMs),
            encrypted: message.media.encrypted,
          }
        : undefined,
      poll: message.poll
        ? {
            question: message.poll.question,
            kind: message.poll.kind,
            maxSelections: optionalNumber(message.poll.maxSelections) ?? 1,
            answers: message.poll.answers,
          }
        : undefined,
      repliedMessage: message.repliedMessage,
      replyUnsupported: message.replyUnsupported,
    }
  }

  private responseFromNative(message: NativeIncomingMessage): MatrixResponse {
    const native = this.native
    if (!native) {
      throw new Error("native Matrix runtime binding is missing")
    }

    return {
      sendText: (body) => native.sendText(message.roomId, body),
      sendMarkdown: (body) => native.sendMarkdown(message.roomId, body),
      sendMedia: async (kind, attachment) => {
        const normalized = await normalizeMediaAttachment(attachment, kind)
        if (kind === "image") {
          await native.sendImage(message.roomId, normalized)
        } else if (kind === "video") {
          await native.sendVideo(message.roomId, normalized)
        } else {
          await native.sendFile(message.roomId, normalized)
        }
      },
      sendImage: async (attachment) =>
        native.sendImage(
          message.roomId,
          await normalizeMediaAttachment(attachment, "image"),
        ),
      sendFile: async (attachment) =>
        native.sendFile(
          message.roomId,
          await normalizeMediaAttachment(attachment, "file"),
        ),
      sendVideo: async (attachment) =>
        native.sendVideo(
          message.roomId,
          await normalizeMediaAttachment(attachment, "video"),
        ),
      sendPoll: (poll) => native.sendPoll(message.roomId, poll),
      replyText: (body) => native.replyText(message.roomId, message.eventId, body),
      replyMarkdown: (body) =>
        native.replyMarkdown(message.roomId, message.eventId, body),
      downloadMedia: (target) => {
        const resolvedTarget = resolveMediaDownloadTarget(target, message)
        return native.downloadMedia(resolvedTarget.roomId, resolvedTarget.eventId)
      },
    }
  }

  private async handleError(context: MatrixErrorContext): Promise<void> {
    try {
      await this.errorHandler(context)
    } catch (error) {
      this.log("error", "Matrix bot error handler failed", {
        component: "sdk",
        error: errorToString(error),
      })
    }
  }

  private defaultErrorHandler(context: MatrixErrorContext): void {
    this.log("error", "Matrix bot error", {
      component: context.phase === "dispatch" ? "dispatch" : "runtime",
      eventId: context.request?.eventId,
      roomId: context.request?.roomId,
      sender: context.request?.sender,
      error: errorToString(context.error),
    })
  }

  private log(
    level: MatrixLogLevel,
    message: string,
    fields: Omit<MatrixLogEvent, "level" | "message">,
  ): void {
    this.logger({ level, message, ...fields })
  }
}

export class SubBot<TConfig extends SubBotConfig = SubBotConfig> {
  readonly name: string
  readonly commands: string[]
  readonly description?: string
  readonly category?: string
  readonly adminOnly: boolean
  readonly config: TConfig
  readonly microBots: MicroBot[] = []
  readonly native
  private pipeline?: {
    middleware: Middleware[]
    handler: Handler
  }

  constructor(options: SubBotOptions<TConfig>) {
    assertPresent("name", options.name)
    this.name = options.name
    this.commands = normalizeCommands(options.command, options.commands)
    assertCommands("sub-bot", this.name, this.commands)
    this.description = options.description
    this.category = options.category
    this.adminOnly = options.adminOnly ?? false
    this.config = (options.config ?? {}) as TConfig
    this.native = nativeBinding
      ? new nativeBinding.SubBot(this.name, this.commands)
      : undefined
  }

  use(...args: [MicroBot] | [...Middleware[], Handler]): this {
    const [microBotOrMiddleware, ...pipeline] = args

    if (microBotOrMiddleware instanceof MicroBot) {
      this.mountMicroBot(microBotOrMiddleware)
      return this
    }

    this.pipeline = createPipeline([microBotOrMiddleware, ...pipeline])
    return this
  }

  private mountMicroBot(microBot: MicroBot): void {
    if (this.microBots.some((existing) => existing.name === microBot.name)) {
      throw new Error(
        `a micro-bot named \`${microBot.name}\` is already registered in \`${this.name}\``,
      )
    }

    const duplicateCommand = firstSharedValue(
      this.microBots.flatMap((existing) => existing.commands),
      microBot.commands,
    )
    if (duplicateCommand) {
      throw new Error(
        `micro-bot command \`${duplicateCommand}\` is already registered in \`${this.name}\``,
      )
    }

    this.microBots.push(microBot)
  }

  async dispatch(req: MatrixRequest, res: MatrixResponse): Promise<number> {
    const scopedReq = scopeByCommand(req, this.commands)
    if (!scopedReq) {
      return 0
    }

    let handled = 0
    for (const microBot of this.microBots) {
      handled += await microBot.dispatch(scopedReq, res)
    }

    if (handled > 0) {
      return handled
    }

    if (this.pipeline) {
      await runPipeline(scopedReq, res, this.pipeline.middleware, this.pipeline.handler)
      handled = 1
    }

    return handled
  }

  matches(req: MatrixRequest): boolean {
    return commandRemainder(req.body, this.commands) !== undefined
  }

  willHandle(req: MatrixRequest): boolean {
    const scopedReq = scopeByCommand(req, this.commands)
    if (!scopedReq) {
      return false
    }

    return this.microBots.some((microBot) => microBot.willHandle(scopedReq))
      || this.pipeline !== undefined
  }
}

export class MicroBot<TConfig extends MicroBotConfig = MicroBotConfig> {
  readonly name: string
  readonly commands: string[]
  readonly description?: string
  readonly adminOnly: boolean
  readonly config: TConfig
  private pipeline?: {
    middleware: Middleware[]
    handler: Handler
  }

  constructor(options: MicroBotOptions<TConfig>) {
    assertPresent("name", options.name)
    this.name = options.name
    this.commands = normalizeCommands(options.command, options.commands)
    assertCommands("micro-bot", this.name, this.commands)
    this.description = options.description
    this.adminOnly = options.adminOnly ?? false
    this.config = (options.config ?? {}) as TConfig
  }

  use(...pipeline: [...Middleware[], Handler]): this {
    this.pipeline = createPipeline(pipeline)
    return this
  }

  async dispatch(req: MatrixRequest, res: MatrixResponse): Promise<number> {
    const scopedReq = scopeByCommand(req, this.commands)
    if (!scopedReq || !this.pipeline) {
      return 0
    }

    await runPipeline(scopedReq, res, this.pipeline.middleware, this.pipeline.handler)
    return 1
  }

  willHandle(req: MatrixRequest): boolean {
    return this.pipeline !== undefined && scopeByCommand(req, this.commands) !== undefined
  }
}

function assertPresent(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${field} is required`)
  }
}

function resolveMatrixBotConfig(
  config: MatrixBotRuntimeConfig = {},
): ResolvedMatrixBotRuntimeConfig {
  return {
    announceSubBotUsage: config.announceSubBotUsage ?? false,
    selfDocumentation: config.selfDocumentation ?? false,
    documentationPath: config.documentationPath ?? "matrix-bot-family.md",
  }
}

function toNativeOptions(options: MatrixBotOptions): {
  homeserverUrl: string
  username: string
  password: string
  recoveryKey: string
  dataDir?: string
} {
  return {
    homeserverUrl: options.homeserverUrl,
    username: options.username,
    password: options.password,
    recoveryKey: options.recoveryKey,
    dataDir: options.dataDir,
  }
}

function generateBotDocumentation(bot: MatrixBot): string {
  const lines = [
    "# Matrix Bot Family Tree",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Main Bot",
    "",
    `- User: ${formatInline(bot.options.username)}`,
    `- Homeserver: ${formatInline(bot.options.homeserverUrl)}`,
    `- Sub-bots: ${bot.subBots.length}`,
    "",
    "## Family Tree",
    "",
    "```text",
    `${bot.options.username || "MatrixBot"}`,
  ]

  if (bot.subBots.length === 0) {
    lines.push("  (no sub-bots mounted)")
  } else {
    for (const subBot of bot.subBots) {
      lines.push(`  -> ${subBot.name} (${subBot.commands.join(", ")})`)
      if (subBot.microBots.length === 0) {
        continue
      }

      for (const microBot of subBot.microBots) {
        lines.push(`      -> ${microBot.name} (${microBot.commands.join(", ")})`)
      }
    }
  }

  lines.push("```", "", "## Commands", "")

  if (bot.subBots.length === 0) {
    lines.push("No commands are mounted.", "")
    return lines.join("\n")
  }

  for (const subBot of bot.subBots) {
    lines.push(`### ${subBot.name}`, "")
    lines.push(`- Type: SubBot`)
    lines.push(`- Commands: ${formatCommandList(subBot.commands)}`)
    lines.push(`- Description: ${subBot.description ?? "No description."}`)
    if (subBot.category) {
      lines.push(`- Category: ${subBot.category}`)
    }
    if (subBot.adminOnly) {
      lines.push(`- Admin only: yes`)
    }

    if (subBot.microBots.length === 0) {
      lines.push("")
      continue
    }

    lines.push("", "| MicroBot | Commands | Description |")
    lines.push("| --- | --- | --- |")
    for (const microBot of subBot.microBots) {
      lines.push(
        `| ${escapeTableCell(microBot.name)} | ${escapeTableCell(formatCommandList(microBot.commands))} | ${escapeTableCell(microBot.description ?? "No description.")} |`,
      )
    }
    lines.push("")
  }

  return lines.join("\n")
}

function formatCommandList(commands: string[]): string {
  return commands.map(formatInline).join(", ")
}

function formatInline(value: string): string {
  return `\`${value.replaceAll("`", "\\`")}\``
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ")
}

function normalizeCommands(
  command: string | string[],
  commands?: string | string[],
): string[] {
  const values = [
    ...arrayFromCommand(command),
    ...arrayFromCommand(commands),
  ].map((value) => value.trim()).filter(Boolean)

  return [...new Set(values)]
}

function arrayFromCommand(command?: string | string[]): string[] {
  if (command === undefined) {
    return []
  }

  return Array.isArray(command) ? command : [command]
}

function assertCommands(kind: string, name: string, commands: string[]): void {
  if (commands.length === 0) {
    throw new Error(`${kind} \`${name}\` requires at least one command`)
  }
}

function firstSharedValue(left: string[], right: string[]): string | undefined {
  const values = new Set(left)
  return right.find((value) => values.has(value))
}

function createPipeline(pipeline: Array<Middleware | Handler>): {
  middleware: Middleware[]
  handler: Handler
} {
  if (pipeline.length === 0) {
    throw new Error("handler is required")
  }

  return {
    middleware: pipeline.slice(0, -1) as Middleware[],
    handler: pipeline[pipeline.length - 1] as Handler,
  }
}

function scopeByCommand(req: MatrixRequest, commands: string[]): MatrixRequest | undefined {
  const remainder = commandRemainder(req.body, commands)
  if (remainder === undefined) {
    return undefined
  }

  return { ...req, body: remainder }
}

function commandRemainder(body: string, commands: string[]): string | undefined {
  const trimmed = body.trim()
  const command = commands.find(
    (candidate) => trimmed === candidate || trimmed.startsWith(`${candidate} `),
  )
  if (!command) {
    return undefined
  }

  return trimmed.slice(command.length).trimStart()
}

function optionalNumber(value: number | bigint | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  return Number(value)
}

function resolveMediaDownloadTarget(
  target: MediaDownloadTarget | undefined,
  message: Pick<NativeIncomingMessage, "roomId" | "eventId">,
): { roomId: string; eventId: string } {
  if (typeof target === "string") {
    return {
      roomId: message.roomId,
      eventId: target,
    }
  }

  return {
    roomId: target?.roomId ?? message.roomId,
    eventId: target?.eventId ?? message.eventId,
  }
}

export async function normalizeMediaAttachment(
  attachment: MediaAttachment,
  kind: MediaKind = "file",
): Promise<NativeMediaAttachment> {
  if (typeof attachment === "string") {
    return mediaAttachmentFromPath(attachment, kind)
  }

  if ("data" in attachment) {
    return attachment
  }

  return mediaAttachmentFromPath(attachment.path, kind, attachment)
}

async function mediaAttachmentFromPath(
  path: string,
  kind: MediaKind,
  options: Pick<MediaPathAttachment, "filename" | "contentType"> = {},
): Promise<NativeMediaAttachment> {
  assertPresent("attachment path", path)

  return {
    filename: options.filename ?? basename(path),
    contentType: options.contentType ?? inferContentType(path, kind),
    data: await readFile(path),
  }
}

function inferContentType(path: string, _kind: MediaKind): string {
  const extension = extname(path).toLowerCase()
  const contentType = contentTypesByExtension[extension]
  if (contentType) {
    return contentType
  }

  return "application/octet-stream"
}

async function runPipeline(
  req: MatrixRequest,
  res: MatrixResponse,
  middleware: Middleware[],
  handler: Handler,
): Promise<void> {
  let index = -1

  async function dispatch(position: number): Promise<void> {
    if (position <= index) {
      throw new Error("next() called multiple times")
    }
    index = position

    const layer = middleware[position]
    if (!layer) {
      await handler(req, res)
      return
    }

    await layer(req, res, () => dispatch(position + 1))
  }

  await dispatch(0)
}

const nativeBinding = loadNativeBinding()

const contentTypesByExtension: Record<string, string> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".csv": "text/csv",
  ".gif": "image/gif",
  ".htm": "text/html",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".m4v": "video/mp4",
  ".md": "text/markdown",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".zip": "application/zip",
}

function defaultLogger(event: MatrixLogEvent): void {
  if (event.level === "debug") {
    return
  }

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...event,
  })

  if (event.level === "error") {
    console.error(line)
  } else if (event.level === "warn") {
    console.warn(line)
  } else {
    console.info(line)
  }
}

function errorToString(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message
  }

  return String(error)
}
