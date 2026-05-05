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

  constructor(options: MatrixBotOptions) {
    assertPresent("homeserverUrl", options.homeserverUrl)
    assertPresent("username", options.username)
    assertPresent("password", options.password)
    assertPresent("recoveryKey", options.recoveryKey)
    this.options = { ...options }
  }

  use(subBot: SubBot): this {
    if (this.subBots.some((existing) => existing.name === subBot.name)) {
      throw new Error(`a sub-bot named \`${subBot.name}\` is already registered`)
    }

    this.subBots.push(subBot)
    return this
  }

  async listen(options: ListenOptions): Promise<never> {
    if (!options.owners.some((owner) => owner.trim().length > 0)) {
      throw new Error("owners is required")
    }

    throw new Error("native Matrix runtime binding is not wired yet")
  }
}

export class SubBot {
  readonly name: string
  readonly routes: RouteLayer[] = []

  constructor(name: string) {
    assertPresent("name", name)
    this.name = name
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
}

function assertPresent(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${field} is required`)
  }
}
