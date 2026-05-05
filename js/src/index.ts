import { loadNativeBinding, type NativeIncomingMessage } from "./native"

export type MatrixBotOptions = {
  homeserverUrl: string
  username: string
  password: string
  recoveryKey: string
  dataDir?: string
}

export type ListenOptions = {
  owners: string[]
  controlPassword?: string
  timelineLimit?: number
}

export type MatrixContext = {
  eventId: string
  roomId: string
  sender: string
  body: string
  repliedMessage?: RepliedMessage
  replyUnsupported: boolean
  sendText(body: string): Promise<void>
  sendMarkdown(body: string): Promise<void>
  replyText(body: string): Promise<void>
  replyMarkdown(body: string): Promise<void>
}

export type RepliedMessage = {
  eventId: string
  sender: string
  body: string
}

export type Next = () => Promise<void>
export type Middleware = (ctx: MatrixContext, next: Next) => Promise<void> | void
export type Handler = (ctx: MatrixContext) => Promise<void> | void
export type RouteMatcher = string | RegExp | ((ctx: MatrixContext) => boolean)

export type RouteLayer = {
  matcher: RouteMatcher
  middleware: Middleware[]
  handler: Handler
}

export class MatrixBot {
  readonly options: MatrixBotOptions
  readonly subBots: SubBot[] = []
  private readonly native

  constructor(options: MatrixBotOptions) {
    assertPresent("homeserverUrl", options.homeserverUrl)
    assertPresent("username", options.username)
    assertPresent("password", options.password)
    assertPresent("recoveryKey", options.recoveryKey)
    this.options = { ...options }
    this.native = nativeBinding
      ? new nativeBinding.MatrixBot(toNativeOptions(this.options))
      : undefined
  }

  use(subBot: SubBot): this {
    if (this.subBots.some((existing) => existing.name === subBot.name)) {
      throw new Error(`a sub-bot named \`${subBot.name}\` is already registered`)
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

  async dispatch(ctx: MatrixContext): Promise<number> {
    let handled = 0
    for (const subBot of this.subBots) {
      handled += await subBot.dispatch(ctx)
    }
    return handled
  }

  async listen(options: ListenOptions): Promise<void> {
    if (!options.owners.some((owner) => owner.trim().length > 0)) {
      throw new Error("owners is required")
    }

    if (!this.native) {
      throw new Error(
        "native Matrix runtime binding is missing; run `devbox run build-native` first",
      )
    }

    this.native.start(
      {
        owners: options.owners,
        timelineLimit: options.timelineLimit,
      },
      (message) => {
        this.dispatch(this.contextFromNative(message)).catch((error) => {
          console.error("Matrix bot handler failed", error)
        })
      },
    )

    await new Promise<void>(() => {})
  }

  private contextFromNative(message: NativeIncomingMessage): MatrixContext {
    return {
      eventId: message.eventId,
      roomId: message.roomId,
      sender: message.sender,
      body: message.body,
      repliedMessage: message.repliedMessage,
      replyUnsupported: message.replyUnsupported,
      sendText: (body) => this.native!.sendText(message.roomId, body),
      sendMarkdown: (body) => this.native!.sendMarkdown(message.roomId, body),
      replyText: (body) =>
        this.native!.replyText(message.roomId, message.eventId, body),
      replyMarkdown: (body) =>
        this.native!.replyMarkdown(message.roomId, message.eventId, body),
    }
  }
}

export class SubBot {
  readonly name: string
  readonly routes: RouteLayer[] = []
  readonly native

  constructor(name: string) {
    assertPresent("name", name)
    this.name = name
    this.native = nativeBinding ? new nativeBinding.SubBot(this.name) : undefined
  }

  use(matcher: RouteMatcher, ...pipeline: [...Middleware[], Handler]): this {
    if (pipeline.length === 0) {
      throw new Error("handler is required")
    }

    const handler = pipeline[pipeline.length - 1] as Handler
    const middleware = pipeline.slice(0, -1) as Middleware[]
    this.routes.push({ matcher, middleware, handler })
    return this
  }

  async dispatch(ctx: MatrixContext): Promise<number> {
    let handled = 0
    for (const route of this.routes) {
      if (!matches(route.matcher, ctx)) {
        continue
      }

      handled += 1
      await runPipeline(ctx, route.middleware, route.handler)
    }
    return handled
  }
}

function assertPresent(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${field} is required`)
  }
}

function toNativeOptions(options: MatrixBotOptions): MatrixBotOptions {
  return { ...options }
}

function matches(matcher: RouteMatcher, ctx: MatrixContext): boolean {
  if (typeof matcher === "string") {
    return ctx.body.trim().startsWith(matcher)
  }

  if (matcher instanceof RegExp) {
    return matcher.test(ctx.body)
  }

  return matcher(ctx)
}

async function runPipeline(
  ctx: MatrixContext,
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
