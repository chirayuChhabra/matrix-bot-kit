import { readFile, writeFile } from "node:fs/promises"
import { basename, extname } from "node:path"
import { exec } from "node:child_process"
import {
  loadNativeBinding,
  type MatrixMessageType,
  type NativeListenerMatrixMessageTrigger,
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
  admin?: string[]
  moderator?: string[]
  timelineLimit?: number
}

export type MatrixBotRuntimeConfig = {
  announceCommandGroupUsage?: boolean
  selfDocumentation?: boolean
  documentationPath?: string
  utility?: boolean
}

type ResolvedMatrixBotRuntimeConfig = {
  announceCommandGroupUsage: boolean
  selfDocumentation: boolean
  documentationPath: string
  utility: boolean
}



export interface SendContext extends Promise<void> {
  message: (body: string) => SendContext
  text: (body: string) => SendContext
  markdown: (body: string) => SendContext
  media: (kind: MediaKind, attachment: MediaAttachment) => SendContext
  image: (attachment: MediaAttachment) => SendContext
  file: (attachment: MediaAttachment) => SendContext
  video: (attachment: MediaAttachment) => SendContext
  poll: (poll: OutboundPoll) => SendContext
}

export interface ReplyContext extends Promise<void> {
  message: (body: string) => ReplyContext
  text: (body: string) => ReplyContext
  markdown: (body: string) => ReplyContext
}

export type Context = {
  message: {
    id: string
    type: MatrixMessageType
    rawBody: string
    body: string
    media?: MediaMessage
    poll?: PollMessage
    reply?: {
      target?: RepliedMessage
      isUnsupported: boolean
    }
  }
  room: {
    id: string
    isDirect: boolean
  }
  sender: {
    id: string
    isAdmin: (userId?: string) => boolean
    isModerator: (userId?: string) => boolean
  }
  send: SendContext
  reply: ReplyContext

  downloadMedia: (target?: MediaDownloadTarget) => Promise<Buffer>
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
  commandGroup?: string
  documentationPath?: string
  handled?: number
  durationMs?: number
  error?: string
}

export type MatrixLogger = (event: MatrixLogEvent) => void

export type MatrixErrorContext = {
  error: unknown
  phase: "dispatch" | "runtime"
  request?: Context
}

export type MatrixErrorHandler = (
  context: MatrixErrorContext,
) => Promise<void> | void

export type Next = () => Promise<void>
export type Middleware = (
  ctx: Context,
  next: Next,
) => Promise<void> | void
export type Handler = (ctx: Context) => Promise<void> | void

export type ListenerEventKind = "matrix.message" | "schedule" | "external"

export type ListenerEvent = {
  id: string
  kind: ListenerEventKind
  source: string
  timestamp: Date
  name?: string
  request?: Context
  payload?: unknown
}

export type ListenerActions = {
  matrix?: Context
}

export type ListenerHandler = (
  event: ListenerEvent,
  actions: ListenerActions,
) => Promise<void> | void

export type ListenerMatrixMessageTrigger = {
  kind: "matrix.message"
  messageTypes?: MatrixMessageType[]
  rooms?: string[]
  senders?: string[]
}

export type ListenerExternalTrigger = {
  kind: "external"
  source?: string | string[]
  event?: string | string[]
}

export type ListenerScheduleTrigger = {
  kind: "schedule"
  everyMs?: number
  at?: Date | string
  source?: string
}

export type ListenerTrigger =
  | "matrix.message"
  | ListenerMatrixMessageTrigger
  | ListenerExternalTrigger
  | ListenerScheduleTrigger

export type ListenerConfig = Record<string, unknown>

export type ListenerOptions<TConfig extends ListenerConfig = ListenerConfig> = {
  name: string
  description?: string
  triggers?: ListenerTrigger[]
  config?: TConfig
}

export type CommandGroupConfig = Record<string, unknown>

export type CommandGroupOptions<TConfig extends CommandGroupConfig = CommandGroupConfig> = {
  name: string
  command: string | string[]
  commands?: string | string[]
  description?: string
  category?: string
  adminOnly?: boolean
  moderatorOnly?: boolean
  roomType?: "direct" | "any"
  config?: TConfig
}

export type CommandConfig = Record<string, unknown>

export type CommandOptions<TConfig extends CommandConfig = CommandConfig> = {
  name: string
  command: string | string[]
  commands?: string | string[]
  description?: string
  adminOnly?: boolean
  moderatorOnly?: boolean
  roomType?: "direct" | "any"
  config?: TConfig
}

export class MatrixBot {
  readonly options: MatrixBotOptions
  readonly commandGroups: CommandGroup[] = []
  readonly listeners: Listener[] = []
  private readonly native
  private readonly logger: MatrixLogger
  private readonly errorHandler: MatrixErrorHandler
  private readonly config: ResolvedMatrixBotRuntimeConfig
  private scheduleTimers: Array<ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>> = []
  private stopResolve?: () => void
  private onListenerCount = 0
  private scheduleListenerCount = 0
  private isUnderMaintenance = false

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

    if (this.config.utility) {
      this.setupUtilityCommands()
    }
  }

  private setupUtilityCommands() {
    this.command("!ping", async (ctx) => {
      await ctx.reply.text("pong")
    })

    this.command("!uptime", async (ctx) => {
      if (!ctx.room.isDirect || !ctx.sender.isAdmin(ctx.sender.id)) return
      const uptime = process.uptime()
      const hours = Math.floor(uptime / 3600)
      const minutes = Math.floor((uptime % 3600) / 60)
      const seconds = Math.floor(uptime % 60)
      await ctx.reply.text(`Total uptime: ${hours}h ${minutes}m ${seconds}s`)
    })

    this.command("!version", async (ctx) => {
      if (!ctx.room.isDirect || !ctx.sender.isAdmin(ctx.sender.id)) return
      try {
        const pkgStr = await readFile("package.json", "utf-8")
        const pkg = JSON.parse(pkgStr)
        await ctx.reply.text(`Version: ${pkg.version}`)
      } catch (e) {
        await ctx.reply.text("Version: unknown")
      }
    })

    this.command("!status", async (ctx) => {
      if (!ctx.room.isDirect || !ctx.sender.isAdmin(ctx.sender.id)) return
      const memUsage = process.memoryUsage()
      const memMB = Math.round(memUsage.rss / 1024 / 1024)
      await ctx.reply.text(`Status:\n- Uptime: ${Math.floor(process.uptime())}s\n- Memory RSS: ${memMB}MB\n- Command Groups: ${this.commandGroups.length}\n- Listeners: ${this.listeners.length}\n- Maintenance: ${this.isUnderMaintenance}`)
    })

    this.command("!maintenance", async (ctx) => {
      if (!ctx.room.isDirect || !ctx.sender.isAdmin(ctx.sender.id)) return
      const password = ctx.message.body.trim()
      // @ts-ignore
      const expectedPassword = typeof Bun !== "undefined" ? Bun.env.MAINTENANCE_PASSWORD : process.env.MAINTENANCE_PASSWORD
      if (!expectedPassword) {
        await ctx.reply.text("Maintenance password not configured.")
        return
      }
      if (password !== expectedPassword) {
        await ctx.reply.text("Invalid password.")
        return
      }
      this.isUnderMaintenance = !this.isUnderMaintenance
      await ctx.reply.text(`Maintenance mode is now ${this.isUnderMaintenance ? "ON" : "OFF"}.`)
    })

    this.command("!shutdown", async (ctx) => {
      if (!ctx.room.isDirect || !ctx.sender.isAdmin(ctx.sender.id)) return
      const password = ctx.message.body.trim()
      // @ts-ignore
      const expectedPassword = typeof Bun !== "undefined" ? Bun.env.MAINTENANCE_PASSWORD : process.env.MAINTENANCE_PASSWORD
      if (password !== expectedPassword) {
        await ctx.reply.text(password ? "Invalid password." : "Password required.")
        return
      }
      await ctx.reply.text("Shutting down gracefully...")
      await this.stop()
      process.exit(0)
    })

    this.command("!reload", async (ctx) => {
      if (!ctx.room.isDirect || !ctx.sender.isAdmin(ctx.sender.id)) return
      const password = ctx.message.body.trim()
      // @ts-ignore
      const expectedPassword = typeof Bun !== "undefined" ? Bun.env.MAINTENANCE_PASSWORD : process.env.MAINTENANCE_PASSWORD
      if (password !== expectedPassword) {
        await ctx.reply.text("Invalid password.")
        return
      }
      await ctx.reply.text("Rebuilding and restarting...")
      exec("sh scripts/reload.sh", (error, stdout, stderr) => {
        if (error) {
          ctx.reply.text(`Reload failed: ${error.message}`).catch(console.error)
        }
      })
    })

    this.command("!help", async (ctx) => {
      let doc = "# Commands\n\n"
      for (const group of this.commandGroups) {
        doc += `## ${group.name}\n`
        for (const cmd of group.commands) {
          doc += `- \`${cmd}\`\n`
        }
      }
      await ctx.reply.markdown(doc)
    })
  }

  use(component: CommandGroup | Listener): this {
    if (component instanceof Listener) {
      return this.useListener(component)
    }

    return this.useCommandGroup(component)
  }

  useCommandGroup(commandGroup: CommandGroup): this {
    if (this.commandGroups.some((existing) => existing.name === commandGroup.name)) {
      throw new Error(`a sub-bot named \`${commandGroup.name}\` is already registered`)
    }

    const duplicateCommand = firstSharedValue(
      this.commandGroups.flatMap((existing) => existing.commands),
      commandGroup.commands,
    )
    if (duplicateCommand) {
      throw new Error(
        `command \`${duplicateCommand}\` is already registered by another sub-bot`,
      )
    }

    this.commandGroups.push(commandGroup)
    if (this.native && commandGroup.native) {
      this.native.registerCommandGroup(commandGroup.native)
    }
    return this
  }

  useListener(listener: Listener): this {
    if (this.listeners.some((existing) => existing.name === listener.name)) {
      throw new Error(`a listener named \`${listener.name}\` is already registered`)
    }

    this.listeners.push(listener)
    if (this.native?.registerListener && listener.native) {
      this.native.registerListener(listener.native)
    }
    return this
  }

  get nativeAvailable(): boolean {
    return this.native !== undefined
  }

  get commandGroupCount(): number {
    return this.native?.commandGroupCount ?? this.commandGroups.length
  }

  get listenerCount(): number {
    return this.native?.listenerCount ?? this.listeners.length
  }

  command(match: string | string[], ...pipeline: [...Middleware[], Handler]): this {
    const group = new CommandGroup({ name: Array.isArray(match) ? match[0] : match, command: match })
    group.use(...pipeline)
    this.useCommandGroup(group)
    return this
  }

  group(match: string | string[]): CommandGroup {
    const group = new CommandGroup({ name: Array.isArray(match) ? match[0] : match, command: match })
    this.useCommandGroup(group)
    return group
  }

  on(trigger: "message" | "image" | "file" | "video" | "poll" | string, handler: ListenerHandler): this {
    const name = `on-${trigger}-${++this.onListenerCount}`
    const triggers: ListenerTrigger[] = trigger === "message"
      ? [{ kind: "matrix.message" }]
      : [{ kind: "matrix.message", messageTypes: [trigger as MatrixMessageType] }]
    const listener = new Listener({ name, triggers })
    listener.use(handler)
    this.useListener(listener)
    return this
  }

  schedule(options: { everyMs?: number; at?: string|Date }, handler: ListenerHandler): this {
    const name = `schedule-${++this.scheduleListenerCount}`
    const listener = new Listener({ name, triggers: [{ kind: "schedule", ...options, source: "schedule" }] })
    listener.use(handler)
    this.useListener(listener)
    return this
  }

  webhook(source: string, event: string, handler: ListenerHandler): this {
    const listener = new Listener({ name: `webhook-${source}-${event}`, triggers: [{ kind: "external", source, event }] })
    listener.use(handler)
    this.useListener(listener)
    return this
  }


  async dispatch(ctx: Context): Promise<number> {
    const started = Date.now()

    const bodyLower = ctx.message.body.toLowerCase().trim()
    if (this.isUnderMaintenance) {
      if (!bodyLower.startsWith("!maintenance") && !bodyLower.startsWith("!shutdown") && !bodyLower.startsWith("!reload")) {
        // Find if it would match a command
        let wouldHandle = false
        for (const commandGroup of this.commandGroups) {
          if (commandGroup.willHandle(ctx)) {
            wouldHandle = true
            break
          }
        }
        if (wouldHandle) {
          await ctx.reply.text("Bot is under maintenance")
          return 1
        }
        return 0
      }
    }

    let handled = 0
    for (const commandGroup of this.commandGroups) {
      try {
        if (commandGroup.willHandle(ctx)) {
          await this.sendCommandGroupUsageNotice(commandGroup, ctx)
        }
        handled += await commandGroup.dispatch(ctx)
      } catch (error) {
        await this.handleError({ error, phase: "dispatch", request: ctx })
      }
    }

    if (handled === 0 && ctx.message.type === "text") {
      this.log("debug", "No command handlers matched", {
        component: "sdk",
        eventId: ctx.message.id,
        roomId: ctx.room.id,
        sender: ctx.sender.id,
      })
    }

    this.log(handled > 0 ? "info" : "debug", "Matrix message dispatched", {
      eventId: ctx.message.id,
      roomId: ctx.room.id,
      sender: ctx.sender.id,
      handled,
      durationMs: Date.now() - started,
      component: "dispatch",
    })
    return handled
  }

  async dispatchListeners(event: ListenerEvent, actions: ListenerActions = {}): Promise<number> {
    const started = Date.now()
    let handled = 0
    for (const listener of this.listeners) {
      try {
        handled += await listener.dispatch(event, actions)
      } catch (error) {
        await this.handleError({ error, phase: "dispatch", request: event.request })
      }
    }

    this.log(handled > 0 ? "info" : "debug", "Listener event dispatched", {
      eventId: event.request?.message.id ?? event.id,
      roomId: event.request?.room.id,
      sender: event.request?.sender.id,
      handled,
      durationMs: Date.now() - started,
      component: "dispatch",
    })
    return handled
  }

  async emitExternal(
    source: string,
    name: string,
    payload?: unknown,
  ): Promise<number> {
    return this.dispatchListeners({
      id: `${source}:${name}:${Date.now()}`,
      kind: "external",
      source,
      name,
      payload,
      timestamp: new Date(),
    })
  }

  private async sendCommandGroupUsageNotice(
    commandGroup: CommandGroup,
    ctx: Context,
  ): Promise<void> {
    if (!this.config.announceCommandGroupUsage) {
      return
    }

    try {
      await ctx.reply.markdown(`> using ${commandGroup.name}...`)
    } catch (error) {
      this.log("warn", "Failed to send command group usage notice", {
        component: "sdk",
        eventId: ctx.message.id,
        roomId: ctx.room.id,
        sender: ctx.sender.id,
        error: errorToString(error),
      })
    }
  }

  async start(callback?: () => void): Promise<void> {
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
      (message) => {
        const ctx = this.contextFromNative(message)
        this.dispatch(ctx).catch((error) => {
          void this.handleError({ error, phase: "dispatch", request: ctx })
        })
        this.dispatchListeners(matrixMessageListenerEvent(ctx), { matrix: ctx }).catch(
          (error) => {
            void this.handleError({ error, phase: "dispatch", request: ctx })
          },
        )
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

    this.startListenerSchedules()

    if (callback) {
      callback()
    }

    await new Promise<void>((resolve) => { this.stopResolve = resolve })
  }

  stop(): void {
    for (const timer of this.scheduleTimers) {
      clearInterval(timer)
    }
    this.scheduleTimers = []
    this.stopResolve?.()
    this.stopResolve = undefined
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

  private startListenerSchedules(): void {
    if (this.scheduleTimers.length > 0) {
      return
    }

    for (const listener of this.listeners) {
      for (const trigger of listener.scheduleTriggers()) {
        if (trigger.everyMs !== undefined) {
          const timer = setInterval(() => {
            void this.dispatchListeners(scheduleListenerEvent(trigger))
          }, trigger.everyMs)
          this.scheduleTimers.push(timer)
        }

        if (trigger.at !== undefined) {
          const delayMs = Math.max(0, new Date(trigger.at).getTime() - Date.now())
          const timer = setTimeout(() => {
            void this.dispatchListeners(scheduleListenerEvent(trigger))
          }, delayMs)
          this.scheduleTimers.push(timer)
        }
      }
    }
  }

  private contextFromNative(message: NativeIncomingMessage): Context {
    const native = this.native;
    if (!native) throw new Error("native Matrix runtime binding is missing");

    return {
      message: {
        id: message.eventId,
        type: message.messageType,
        rawBody: message.body,
        body: message.body,
        media: message.media ? {
          ...message.media,
          size: message.media.size != null ? Number(message.media.size) : undefined,
          width: message.media.width != null ? Number(message.media.width) : undefined,
          height: message.media.height != null ? Number(message.media.height) : undefined,
          durationMs: message.media.durationMs != null ? Number(message.media.durationMs) : undefined,
        } : undefined,
        poll: message.poll ? { ...message.poll, maxSelections: Number(message.poll.maxSelections ?? 1) } : undefined,
        reply: (message.repliedMessage || message.replyUnsupported) ? {
          target: message.repliedMessage,
          isUnsupported: message.replyUnsupported
        } : undefined,
      },
      room: {
        id: message.roomId,
        isDirect: message.is_direct,
      },
      sender: {
        id: message.sender,
        isAdmin: (userId) => {
          const u = userId ?? message.sender
          return this.options.admin?.includes(u) ?? false
        },
        isModerator: (userId) => {
          const u = userId ?? message.sender
          if (this.options.admin?.includes(u)) return true
          return this.options.moderator?.includes(u) ?? false
        },
      },
      send: (() => {
        let promise = Promise.resolve();
        const sendCtx: SendContext = {
          then: (onfulfilled: any, onrejected: any) => promise.then(onfulfilled, onrejected),
          catch: (onrejected: any) => promise.catch(onrejected),
          finally: (onfinally: any) => promise.finally(onfinally),
          get [Symbol.toStringTag]() { return "Promise" },
          message: (body: string) => { promise = promise.then(() => native.sendText(message.roomId, body)); return sendCtx; },
          text: (body: string) => sendCtx.message(body),
          markdown: (body: string) => { promise = promise.then(() => native.sendMarkdown(message.roomId, body)); return sendCtx; },
          media: (kind: MediaKind, attachment: MediaAttachment) => {
            promise = promise.then(async () => {
              const normalized = await normalizeMediaAttachment(attachment, kind)
              if (kind === "image") await native.sendImage(message.roomId, normalized)
              else if (kind === "video") await native.sendVideo(message.roomId, normalized)
              else await native.sendFile(message.roomId, normalized)
            })
            return sendCtx;
          },
          image: (attachment: MediaAttachment) => {
            promise = promise.then(async () => {
              await native.sendImage(message.roomId, await normalizeMediaAttachment(attachment, "image"))
            })
            return sendCtx;
          },
          file: (attachment: MediaAttachment) => {
            promise = promise.then(async () => {
              await native.sendFile(message.roomId, await normalizeMediaAttachment(attachment, "file"))
            })
            return sendCtx;
          },
          video: (attachment: MediaAttachment) => {
            promise = promise.then(async () => {
              await native.sendVideo(message.roomId, await normalizeMediaAttachment(attachment, "video"))
            })
            return sendCtx;
          },
          poll: (poll: OutboundPoll) => { promise = promise.then(() => native.sendPoll(message.roomId, poll)); return sendCtx; }
        } as unknown as SendContext;
        return sendCtx;
      })(),
      reply: (() => {
        let promise = Promise.resolve();
        const replyCtx: ReplyContext = {
          then: (onfulfilled: any, onrejected: any) => promise.then(onfulfilled, onrejected),
          catch: (onrejected: any) => promise.catch(onrejected),
          finally: (onfinally: any) => promise.finally(onfinally),
          get [Symbol.toStringTag]() { return "Promise" },
          message: (body: string) => { promise = promise.then(() => native.replyText(message.roomId, message.eventId, body)); return replyCtx; },
          text: (body: string) => replyCtx.message(body),
          markdown: (body: string) => { promise = promise.then(() => native.replyMarkdown(message.roomId, message.eventId, body)); return replyCtx; }
        } as unknown as ReplyContext;
        return replyCtx;
      })(),
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
      eventId: context.request?.message.id,
      roomId: context.request?.room.id,
      sender: context.request?.sender.id,
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

export class Listener<TConfig extends ListenerConfig = ListenerConfig> {
  readonly name: string
  readonly description?: string
  readonly triggers: NormalizedListenerTrigger[]
  readonly config: TConfig
  readonly native
  private handler?: ListenerHandler

  constructor(options: ListenerOptions<TConfig>) {
    assertPresent("name", options.name)
    this.name = options.name
    this.description = options.description
    this.triggers = normalizeListenerTriggers(options.triggers)
    this.config = (options.config ?? {}) as TConfig
    this.native = nativeBinding?.Listener
      ? new nativeBinding.Listener(this.name, nativeListenerMatrixMessageTriggers(this.triggers))
      : undefined
  }

  use(handler: ListenerHandler): this {
    this.handler = handler
    return this
  }

  async dispatch(event: ListenerEvent, actions: ListenerActions): Promise<number> {
    if (!this.handler || !this.matches(event)) {
      return 0
    }

    await this.handler(event, actions)
    return 1
  }

  matches(event: ListenerEvent): boolean {
    return this.triggers.some((trigger) => listenerTriggerMatches(trigger, event))
  }

  scheduleTriggers(): NormalizedListenerScheduleTrigger[] {
    return this.triggers.filter(
      (trigger): trigger is NormalizedListenerScheduleTrigger =>
        trigger.kind === "schedule",
    )
  }
}

export class CommandGroup<TConfig extends CommandGroupConfig = CommandGroupConfig> {
  readonly name: string
  readonly commands: string[]
  readonly description?: string
  readonly category?: string
  readonly adminOnly: boolean
  readonly moderatorOnly: boolean
  readonly roomType: "direct" | "any"
  readonly config: TConfig
  readonly childCommands: Command[] = []
  readonly native
  private pipeline?: {
    middleware: Middleware[]
    handler: Handler
  }

  constructor(options: CommandGroupOptions<TConfig>) {
    assertPresent("name", options.name)
    this.name = options.name
    this.commands = normalizeCommands(options.command, options.commands)
    assertCommands("sub-bot", this.name, this.commands)
    this.description = options.description
    this.category = options.category
    this.adminOnly = options.adminOnly ?? false
    this.moderatorOnly = options.moderatorOnly ?? false
    this.roomType = options.roomType ?? "any"
    this.config = (options.config ?? {}) as TConfig
    this.native = nativeBinding
      ? new nativeBinding.CommandGroup(this.name, this.commands)
      : undefined
  }

  use(...args: [Command] | [...Middleware[], Handler]): this {
    const [commandOrMiddleware, ...pipeline] = args

    if (commandOrMiddleware instanceof Command) {
      this.mountCommand(commandOrMiddleware)
      return this
    }

    this.pipeline = createPipeline([commandOrMiddleware, ...pipeline])
    return this
  }

  private mountCommand(command: Command): void {
    if (this.childCommands.some((existing) => existing.name === command.name)) {
      throw new Error(
        `a micro-bot named \`${command.name}\` is already registered in \`${this.name}\``,
      )
    }

    const duplicateCommand = firstSharedValue(
      this.childCommands.flatMap((existing) => existing.commands),
      command.commands,
    )
    if (duplicateCommand) {
      throw new Error(
        `micro-bot command \`${duplicateCommand}\` is already registered in \`${this.name}\``,
      )
    }

    this.childCommands.push(command)
  }

  async dispatch(ctx: Context): Promise<number> {
    const scopedCtx = scopeByCommand(ctx, this.commands)
    if (!scopedCtx) {
      return 0
    }

    if (this.adminOnly && !ctx.sender.isAdmin()) return 0
    if (this.moderatorOnly && !ctx.sender.isModerator()) return 0
    if (this.roomType === "direct" && !ctx.room.isDirect) return 0

    let handled = 0
    for (const command of this.childCommands) {
      handled += await command.dispatch(scopedCtx)
    }

    if (handled > 0) {
      return handled
    }

    if (this.pipeline) {
      await runPipeline(scopedCtx, this.pipeline.middleware, this.pipeline.handler)
      handled = 1
    }

    return handled
  }

  matches(ctx: Context): boolean {
    return commandRemainder(ctx.message.body, this.commands) !== undefined
  }

  willHandle(ctx: Context): boolean {
    const scopedCtx = scopeByCommand(ctx, this.commands)
    if (!scopedCtx) {
      return false
    }

    return this.childCommands.some((command) => command.willHandle(scopedCtx))
      || this.pipeline !== undefined
  }


  command(match: string | string[], ...pipeline: [...Middleware[], Handler]): this {
    const cmd = new Command({ name: Array.isArray(match) ? match[0] : match, command: match })
    cmd.use(...pipeline)
    this.use(cmd)
    return this
  }

  default(...pipeline: [...Middleware[], Handler]): this {
    this.use(...pipeline)
    return this
  }
}

export class Command<TConfig extends CommandConfig = CommandConfig> {
  readonly name: string
  readonly commands: string[]
  readonly description?: string
  readonly adminOnly: boolean
  readonly moderatorOnly: boolean
  readonly roomType: "direct" | "any"
  readonly config: TConfig
  private pipeline?: {
    middleware: Middleware[]
    handler: Handler
  }

  constructor(options: CommandOptions<TConfig>) {
    assertPresent("name", options.name)
    this.name = options.name
    this.commands = normalizeCommands(options.command, options.commands)
    assertCommands("micro-bot", this.name, this.commands)
    this.description = options.description
    this.adminOnly = options.adminOnly ?? false
    this.moderatorOnly = options.moderatorOnly ?? false
    this.roomType = options.roomType ?? "any"
    this.config = (options.config ?? {}) as TConfig
  }

  use(...pipeline: [...Middleware[], Handler]): this {
    this.pipeline = createPipeline(pipeline)
    return this
  }

  async dispatch(ctx: Context): Promise<number> {
    const scopedCtx = scopeByCommand(ctx, this.commands)
    if (!scopedCtx || !this.pipeline) {
      return 0
    }

    if (this.adminOnly && !scopedCtx.sender.isAdmin()) return 0
    if (this.moderatorOnly && !scopedCtx.sender.isModerator()) return 0
    if (this.roomType === "direct" && !scopedCtx.room.isDirect) return 0

    await runPipeline(scopedCtx, this.pipeline.middleware, this.pipeline.handler)
    return 1
  }

  willHandle(ctx: Context): boolean {
    return this.pipeline !== undefined && scopeByCommand(ctx, this.commands) !== undefined
  }
}

type NormalizedListenerMatrixMessageTrigger = {
  kind: "matrix.message"
  messageTypes?: MatrixMessageType[]
  rooms?: string[]
  senders?: string[]
}

type NormalizedListenerExternalTrigger = {
  kind: "external"
  source?: string[]
  event?: string[]
}

type NormalizedListenerScheduleTrigger = {
  kind: "schedule"
  everyMs?: number
  at?: Date | string
  source: string
}

type NormalizedListenerTrigger =
  | NormalizedListenerMatrixMessageTrigger
  | NormalizedListenerExternalTrigger
  | NormalizedListenerScheduleTrigger

function normalizeListenerTriggers(
  triggers: ListenerTrigger[] = ["matrix.message"],
): NormalizedListenerTrigger[] {
  return triggers.map((trigger) => {
    if (trigger === "matrix.message") {
      return { kind: "matrix.message" }
    }

    if (trigger.kind === "external") {
      return {
        ...trigger,
        source: arrayFromOptionalValue(trigger.source),
        event: arrayFromOptionalValue(trigger.event),
      }
    }

    if (trigger.kind === "schedule") {
      if (trigger.everyMs === undefined && trigger.at === undefined) {
        throw new Error("schedule listener trigger requires `everyMs` or `at`")
      }
      if (trigger.everyMs !== undefined && trigger.everyMs <= 0) {
        throw new Error("schedule listener trigger `everyMs` must be greater than 0")
      }

      return {
        ...trigger,
        source: trigger.source ?? "schedule",
      }
    }

    return trigger
  })
}

function nativeListenerMatrixMessageTriggers(
  triggers: NormalizedListenerTrigger[],
): NativeListenerMatrixMessageTrigger[] {
  return triggers
    .filter(
      (trigger): trigger is NormalizedListenerMatrixMessageTrigger =>
        trigger.kind === "matrix.message",
    )
    .map((trigger) => ({
      messageTypes: trigger.messageTypes,
    }))
}

function listenerTriggerMatches(
  trigger: NormalizedListenerTrigger,
  event: ListenerEvent,
): boolean {
  if (trigger.kind !== event.kind) {
    return false
  }

  if (trigger.kind === "matrix.message") {
    const request = event.request
    if (!request) {
      return false
    }

    return matchesOptionalList(trigger.messageTypes, request.message.type)
      && matchesOptionalList(trigger.rooms, request.room.id)
      && matchesOptionalList(trigger.senders, request.sender.id)
  }

  if (trigger.kind === "external") {
    return matchesOptionalList(trigger.source, event.source)
      && matchesOptionalList(trigger.event, event.name)
  }

  return matchesOptionalList([trigger.source], event.source)
}

function matrixMessageListenerEvent(request: Context): ListenerEvent {
  return {
    id: request.message.id,
    kind: "matrix.message",
    source: "matrix",
    request,
    timestamp: new Date(),
  }
}

function scheduleListenerEvent(trigger: NormalizedListenerScheduleTrigger): ListenerEvent {
  return {
    id: `${trigger.source}:${Date.now()}`,
    kind: "schedule",
    source: trigger.source,
    timestamp: new Date(),
  }
}

function matchesOptionalList<T>(values: readonly T[] | undefined, value: T | undefined): boolean {
  return values === undefined || values.length === 0 || (
    value !== undefined && values.includes(value)
  )
}

function arrayFromOptionalValue(value?: string | string[]): string[] | undefined {
  if (value === undefined) {
    return undefined
  }

  return Array.isArray(value) ? value : [value]
}

function assertPresent(field: string, value: string): void {
  if (!value || value.trim().length === 0) {
    throw new Error(`${field} is required`)
  }
}

function resolveMatrixBotConfig(
  config: MatrixBotRuntimeConfig = {},
): ResolvedMatrixBotRuntimeConfig {
  return {
    announceCommandGroupUsage: config.announceCommandGroupUsage ?? false,
    selfDocumentation: config.selfDocumentation ?? false,
    documentationPath: config.documentationPath ?? "matrix-bot-family.md",
    utility: config.utility ?? false,
  }
}

function toNativeOptions(options: MatrixBotOptions): {
  homeserverUrl: string
  username: string
  password: string
  recoveryKey: string
  dataDir?: string
  admin?: string[]
  moderator?: string[]
  timeline_limit?: number
} {
  return {
    homeserverUrl: options.homeserverUrl,
    username: options.username,
    password: options.password,
    recoveryKey: options.recoveryKey,
    dataDir: options.dataDir,
    admin: options.admin,
    moderator: options.moderator,
    timeline_limit: options.timelineLimit,
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
    `- Sub-bots: ${bot.commandGroups.length}`,
    `- Listeners: ${bot.listeners.length}`,
    "",
    "## Family Tree",
    "",
    "```text",
    `${bot.options.username || "MatrixBot"}`,
  ]

  if (bot.commandGroups.length === 0) {
    lines.push("  (no sub-bots mounted)")
  } else {
    for (const commandGroup of bot.commandGroups) {
      lines.push(`  -> ${commandGroup.name} (${commandGroup.commands.join(", ")})`)
      if (commandGroup.childCommands.length === 0) {
        continue
      }

      for (const command of commandGroup.childCommands) {
        lines.push(`      -> ${command.name} (${command.commands.join(", ")})`)
      }
    }
  }

  if (bot.listeners.length > 0) {
    for (const listener of bot.listeners) {
      lines.push(`  -> ${listener.name} [listener]`)
    }
  }

  lines.push("```", "", "## Commands", "")

  if (bot.commandGroups.length === 0 && bot.listeners.length === 0) {
    lines.push("No commands are mounted.", "")
    return lines.join("\n")
  }

  for (const commandGroup of bot.commandGroups) {
    lines.push(`### ${commandGroup.name}`, "")
    lines.push(`- Type: CommandGroup`)
    lines.push(`- Commands: ${formatCommandList(commandGroup.commands)}`)
    lines.push(`- Description: ${commandGroup.description ?? "No description."}`)
    if (commandGroup.category) {
      lines.push(`- Category: ${commandGroup.category}`)
    }
    if (commandGroup.adminOnly) {
      lines.push(`- Admin only: yes`)
    }

    if (commandGroup.childCommands.length === 0) {
      lines.push("")
      continue
    }

    lines.push("", "| Command | Commands | Description |")
    lines.push("| --- | --- | --- |")
    for (const command of commandGroup.childCommands) {
      lines.push(
        `| ${escapeTableCell(command.name)} | ${escapeTableCell(formatCommandList(command.commands))} | ${escapeTableCell(command.description ?? "No description.")} |`,
      )
    }
    lines.push("")
  }

  if (bot.listeners.length > 0) {
    lines.push("## Listeners", "")
    for (const listener of bot.listeners) {
      lines.push(`### ${listener.name}`, "")
      lines.push(`- Type: Listener`)
      lines.push(`- Triggers: ${formatListenerTriggers(listener.triggers)}`)
      lines.push(`- Description: ${listener.description ?? "No description."}`)
      lines.push("")
    }
  }

  return lines.join("\n")
}

function formatCommandList(commands: string[]): string {
  return commands.map(formatInline).join(", ")
}

function formatListenerTriggers(triggers: NormalizedListenerTrigger[]): string {
  return triggers.map((trigger) => formatInline(trigger.kind)).join(", ")
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

function scopeByCommand(ctx: Context, commands: string[]): Context | undefined {
  const remainder = commandRemainder(ctx.message.body, commands)
  if (remainder === undefined) {
    return undefined
  }

  return { ...ctx, message: { ...ctx.message, body: remainder } }
}

function commandRemainder(body: string, commands: string[]): string | undefined {
  const trimmed = body.trim()
  const lower = trimmed.toLowerCase()
  const command = commands.find(
    (candidate) => {
      const lc = candidate.toLowerCase()
      return lower === lc || lower.startsWith(`${lc} `)
    },
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
    assertPresent("media download target eventId", target)
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

function inferContentType(path: string, kind: MediaKind): string {
  const extension = extname(path).toLowerCase()
  const contentType = contentTypesByExtension[extension]
  if (contentType) {
    return contentType
  }

  switch (kind) {
    case "image": return "image/png"
    case "video": return "video/mp4"
    default: return "application/octet-stream"
  }
}

async function runPipeline(
  ctx: Context,
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
      await handler(ctx)
      return
    }

    await layer(ctx, () => dispatch(position + 1))
  }

  await dispatch(0)
}

const nativeBinding = loadNativeBinding()

const contentTypesByExtension: Record<string, string> = {
  ".7z": "application/x-7z-compressed",
  ".aac": "audio/aac",
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".flac": "audio/flac",
  ".gif": "image/gif",
  ".gz": "application/gzip",
  ".htm": "text/html",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".m4v": "video/mp4",
  ".md": "text/markdown",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".rar": "application/vnd.rar",
  ".svg": "image/svg+xml",
  ".tar": "application/x-tar",
  ".tiff": "image/tiff",
  ".txt": "text/plain",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "application/xml",
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
