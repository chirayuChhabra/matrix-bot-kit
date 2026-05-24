import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  MatrixBot,
  Ajent,
  MicroBot,
  SubBot,
  normalizeMediaAttachment,
  type MatrixResponse,
} from "../src/index"

const options = {
  homeserverUrl: "https://matrix.example.org",
  username: "@bot:example.org",
  password: "secret",
  recoveryKey: "recovery",
  config: {
    announceSubBotUsage: false,
    selfDocumentation: false,
  },
  logger() {},
}

test("registers sub-bots in mount order", () => {
  const bot = new MatrixBot(options)
  const factcheck = new SubBot({ name: "factcheck", command: "!check" })
  const imdb = new SubBot({ name: "imdb", command: "!imdb" })

  bot.use(factcheck).use(imdb)

  expect(bot.subBots.map((subBot) => subBot.name)).toEqual(["factcheck", "imdb"])
})

test("stores sub-bot metadata from object options", () => {
  const subBot = new SubBot({
    name: "weather",
    command: ["!weather", "!w"],
    description: "Gets the current forecast.",
    category: "Utility",
    adminOnly: true,
    config: { units: "metric" },
  })

  expect(subBot.name).toBe("weather")
  expect(subBot.commands).toEqual(["!weather", "!w"])
  expect(subBot.description).toBe("Gets the current forecast.")
  expect(subBot.category).toBe("Utility")
  expect(subBot.adminOnly).toBe(true)
  expect(subBot.config).toEqual({ units: "metric" })
})

test("rejects duplicate sub-bot names", () => {
  const bot = new MatrixBot(options)

  bot.use(new SubBot({ name: "factcheck", command: "!check" }))

  expect(() => bot.use(new SubBot({ name: "factcheck", command: "!fc" }))).toThrow(
    "a sub-bot named `factcheck` is already registered",
  )
})

test("rejects duplicate sub-bot commands", () => {
  const bot = new MatrixBot(options)

  bot.use(new SubBot({ name: "factcheck", command: ["!check", "!fc"] }))

  expect(() =>
    bot.use(new SubBot({ name: "claims", command: ["!claim", "!fc"] })),
  ).toThrow("command `!fc` is already registered by another sub-bot")
})

test("registers ajents in mount order", () => {
  const bot = new MatrixBot(options)
  const watcher = new Ajent({ name: "watcher" })
  const indexer = new Ajent({ name: "indexer" })

  bot.use(watcher).use(indexer)

  expect(bot.ajents.map((ajent) => ajent.name)).toEqual(["watcher", "indexer"])
  expect(bot.ajentCount).toBe(2)
})

test("rejects duplicate ajent names", () => {
  const bot = new MatrixBot(options)

  bot.use(new Ajent({ name: "watcher" }))

  expect(() => bot.use(new Ajent({ name: "watcher" }))).toThrow(
    "an ajent named `watcher` is already registered",
  )
})

test("ajents handle every Matrix message without requiring a command", async () => {
  const bot = new MatrixBot(options)
  const watcher = new Ajent({ name: "watcher" })
  const calls: string[] = []

  watcher.use(async (event, actions) => {
    calls.push(`${event.kind}:${event.request?.body}`)
    await actions.matrix?.replyText("seen")
  })
  bot.use(watcher)

  const handled = await bot.dispatchAjents(
    {
      id: "$event",
      kind: "matrix.message",
      source: "matrix",
      request: testRequest("hello without command"),
      timestamp: new Date("2026-05-12T00:00:00.000Z"),
    },
    {
      matrix: testResponse({
        async replyText(body) {
          calls.push(`reply:${body}`)
        },
      }),
    },
  )

  expect(handled).toBe(1)
  expect(calls).toEqual(["matrix.message:hello without command", "reply:seen"])
})

test("ajent Matrix triggers can filter by message metadata", async () => {
  const bot = new MatrixBot(options)
  const imageWatcher = new Ajent({
    name: "image-watcher",
    triggers: [{ kind: "matrix.message", messageTypes: ["image"] }],
  })
  const calls: string[] = []

  imageWatcher.use(async (event) => {
    calls.push(event.request?.media?.filename ?? "missing")
  })
  bot.use(imageWatcher)

  expect(
    await bot.dispatchAjents({
      id: "$text",
      kind: "matrix.message",
      source: "matrix",
      request: testRequest("plain"),
      timestamp: new Date("2026-05-12T00:00:00.000Z"),
    }),
  ).toBe(0)
  expect(
    await bot.dispatchAjents({
      id: "$image",
      kind: "matrix.message",
      source: "matrix",
      request: {
        ...testRequest("cat.png"),
        eventId: "$image",
        messageType: "image",
        media: {
          kind: "image",
          filename: "cat.png",
          encrypted: false,
        },
      },
      timestamp: new Date("2026-05-12T00:00:00.000Z"),
    }),
  ).toBe(1)

  expect(calls).toEqual(["cat.png"])
})

test("ajents can be activated from external sources", async () => {
  const bot = new MatrixBot(options)
  const stripe = new Ajent({
    name: "stripe-fulfillment",
    triggers: [{ kind: "external", source: "stripe", event: "payment.succeeded" }],
  })
  const calls: unknown[] = []

  stripe.use(async (event) => {
    calls.push(event.payload)
  })
  bot.use(stripe)

  expect(await bot.emitExternal("github", "payment.succeeded", { id: "evt_wrong" })).toBe(0)
  expect(await bot.emitExternal("stripe", "payment.succeeded", { id: "evt_123" })).toBe(1)
  expect(calls).toEqual([{ id: "evt_123" }])
})

test("rejects sub-bots without commands", () => {
  expect(() => new SubBot({ name: "weather", command: [] })).toThrow(
    "sub-bot `weather` requires at least one command",
  )
})

test("dispatches directly to a sub-bot handler without requiring micro-bots", async () => {
  const bot = new MatrixBot(options)
  const ping = new SubBot({ name: "ping", command: ["!ping", "!p"] })
  const calls: string[] = []

  ping.use(async (req, res) => {
    calls.push(req.body)
    await res.replyText("pong")
  })
  bot.use(ping)

  const handled = await bot.dispatch(
    testRequest("!p hello"),
    testResponse({
      async replyText(body) {
        calls.push(`reply:${body}`)
      },
    }),
  )

  expect(handled).toBe(1)
  expect(calls).toEqual(["hello", "reply:pong"])
})

test("registers micro-bots under a sub-bot", () => {
  const subBot = new SubBot({ name: "weather", command: "!weather" })
  const current = new MicroBot({ name: "current", command: "current" })
  const forecast = new MicroBot({ name: "forecast", command: "forecast" })

  subBot.use(current).use(forecast)

  expect(subBot.microBots.map((microBot) => microBot.name)).toEqual([
    "current",
    "forecast",
  ])
})

test("rejects duplicate micro-bot names inside a sub-bot", () => {
  const subBot = new SubBot({ name: "weather", command: "!weather" })

  subBot.use(new MicroBot({ name: "current", command: "current" }))

  expect(() =>
    subBot.use(new MicroBot({ name: "current", command: "now" })),
  ).toThrow("a micro-bot named `current` is already registered in `weather`")
})

test("rejects duplicate micro-bot commands inside a sub-bot", () => {
  const subBot = new SubBot({ name: "weather", command: "!weather" })

  subBot.use(new MicroBot({ name: "current", command: ["current", "now"] }))

  expect(() =>
    subBot.use(new MicroBot({ name: "forecast", command: ["forecast", "now"] })),
  ).toThrow("micro-bot command `now` is already registered in `weather`")
})

test("dispatches through sub-bot command then micro-bot command", async () => {
  const bot = new MatrixBot(options)
  const weather = new SubBot({
    name: "weather",
    command: ["!weather", "!w"],
  })
  const current = new MicroBot({
    name: "current",
    command: ["current", "now"],
  })
  const calls: string[] = []

  current.use(async (req, res) => {
    calls.push(req.body)
    await res.replyText("ok")
  })

  weather.use(current)
  bot.use(weather)

  const handled = await bot.dispatch(
    testRequest("!w now delhi"),
    testResponse({
      async replyText(body) {
        calls.push(`reply:${body}`)
      },
    }),
  )

  expect(handled).toBe(1)
  expect(calls).toEqual(["delhi", "reply:ok"])
})

test("prefers matching micro-bots before a sub-bot fallback handler", async () => {
  const bot = new MatrixBot(options)
  const weather = new SubBot({ name: "weather", command: "!weather" })
  const current = new MicroBot({ name: "current", command: "current" })
  const calls: string[] = []

  current.use(async (req) => {
    calls.push(`micro:${req.body}`)
  })
  weather.use(current)
  weather.use(async (req) => {
    calls.push(`fallback:${req.body}`)
  })
  bot.use(weather)

  expect(await bot.dispatch(testRequest("!weather current delhi"), testResponse())).toBe(1)
  expect(await bot.dispatch(testRequest("!weather delhi"), testResponse())).toBe(1)
  expect(calls).toEqual(["micro:delhi", "fallback:delhi"])
})

test("does not match partial command tokens", async () => {
  const bot = new MatrixBot(options)
  const weather = new SubBot({ name: "weather", command: "!w" })
  const current = new MicroBot({ name: "current", command: "now" })
  const calls: string[] = []

  current.use(async () => {
    calls.push("handler")
  })

  weather.use(current)
  bot.use(weather)

  expect(await bot.dispatch(testRequest("!weather now delhi"), testResponse())).toBe(0)
  expect(await bot.dispatch(testRequest("!w nowhere delhi"), testResponse())).toBe(0)
  expect(calls).toEqual([])
})

test("dispatches middleware before micro-bot handler", async () => {
  const bot = new MatrixBot(options)
  const factcheck = new SubBot({ name: "factcheck", command: "!check" })
  const claim = new MicroBot({ name: "claim", command: "claim" })
  const calls: string[] = []

  claim.use(
    async (_req, _res, next) => {
      calls.push("middleware:before")
      await next()
      calls.push("middleware:after")
    },
    async () => {
      calls.push("handler")
    },
  )

  factcheck.use(claim)
  bot.use(factcheck)

  const handled = await bot.dispatch(
    testRequest("!check claim moon is cheese"),
    testResponse(),
  )

  expect(handled).toBe(1)
  expect(calls).toEqual(["middleware:before", "handler", "middleware:after"])
})

test("passes request and response separately", async () => {
  const bot = new MatrixBot(options)
  const factcheck = new SubBot({ name: "factcheck", command: "!check" })
  const claim = new MicroBot({ name: "claim", command: "claim" })
  const calls: string[] = []

  claim.use(async (request, response) => {
    calls.push(`body:${request.body}`)
    await response.replyText("ok")
  })

  factcheck.use(claim)
  bot.use(factcheck)

  const handled = await bot.dispatch(
    testRequest("!check claim this claim"),
    testResponse({
      async replyText(body) {
        calls.push(`reply:${body}`)
      },
    }),
  )

  expect(handled).toBe(1)
  expect(calls).toEqual(["body:this claim", "reply:ok"])
})

test("passes replied message metadata to handlers", async () => {
  const bot = new MatrixBot(options)
  const ping = new SubBot({ name: "ping", command: "!ping" })
  const calls: string[] = []

  ping.use(async (req) => {
    calls.push(req.repliedMessage?.eventId ?? "missing")
    calls.push(req.repliedMessage?.sender ?? "missing")
    calls.push(req.repliedMessage?.messageType ?? "missing")
    calls.push(req.repliedMessage?.media?.filename ?? "missing")
  })
  bot.use(ping)

  const handled = await bot.dispatch(
    {
      ...testRequest("!ping"),
      repliedMessage: {
        eventId: "$reply",
        sender: "@alice:example.org",
        messageType: "image",
        body: "photo caption",
        media: {
          kind: "image",
          filename: "photo.png",
          caption: "photo caption",
          mimetype: "image/png",
          size: 42,
          encrypted: false,
        },
      },
    },
    testResponse(),
  )

  expect(handled).toBe(1)
  expect(calls).toEqual(["$reply", "@alice:example.org", "image", "photo.png"])
})

test("passes unsupported reply state to handlers", async () => {
  const bot = new MatrixBot(options)
  const ping = new SubBot({ name: "ping", command: "!ping" })
  const calls: boolean[] = []

  ping.use(async (req) => {
    calls.push(req.replyUnsupported)
  })
  bot.use(ping)

  const handled = await bot.dispatch(
    { ...testRequest("!ping"), replyUnsupported: true },
    testResponse(),
  )

  expect(handled).toBe(1)
  expect(calls).toEqual([true])
})

test("announces the matched sub-bot before running its handler when enabled", async () => {
  const bot = new MatrixBot({
    ...options,
    config: {
      announceSubBotUsage: true,
      selfDocumentation: false,
    },
  })
  const weather = new SubBot({ name: "weather", command: "!weather" })
  const current = new MicroBot({ name: "current", command: "current" })
  const calls: string[] = []

  current.use(async (_req, res) => {
    calls.push("handler")
    await res.replyText("ok")
  })
  weather.use(current)
  bot.use(weather)

  const handled = await bot.dispatch(
    testRequest("!weather current delhi"),
    testResponse({
      async sendText(body) {
        calls.push(`send:${body}`)
      },
      async sendMarkdown(body) {
        calls.push(`markdown:${body}`)
      },
      async replyText(body) {
        calls.push(`reply:${body}`)
      },
    }),
  )

  expect(handled).toBe(1)
  expect(calls).toEqual(["markdown:> using weather...", "handler", "reply:ok"])
})

test("does not announce sub-bot usage by default", async () => {
  const bot = new MatrixBot({
    ...options,
    config: {
      selfDocumentation: false,
    },
  })
  const ping = new SubBot({ name: "ping", command: "!ping" })
  const calls: string[] = []

  ping.use(async (_req, res) => {
    calls.push("handler")
    await res.replyText("pong")
  })
  bot.use(ping)

  const handled = await bot.dispatch(
    testRequest("!ping"),
    testResponse({
      async sendMarkdown(body) {
        calls.push(`markdown:${body}`)
      },
      async replyText(body) {
        calls.push(`reply:${body}`)
      },
    }),
  )

  expect(handled).toBe(1)
  expect(calls).toEqual(["handler", "reply:pong"])
})

test("does not announce top-level command matches that have no runnable handler", async () => {
  const bot = new MatrixBot({
    ...options,
    config: {
      announceSubBotUsage: true,
      selfDocumentation: false,
    },
  })
  const weather = new SubBot({ name: "weather", command: "!weather" })
  const current = new MicroBot({ name: "current", command: "current" })
  const notices: string[] = []

  current.use(async () => {})
  weather.use(current)
  bot.use(weather)

  const handled = await bot.dispatch(
    testRequest("!weather unknown delhi"),
    testResponse({
      async sendMarkdown(body) {
        notices.push(body)
      },
    }),
  )

  expect(handled).toBe(0)
  expect(notices).toEqual([])
})

test("does not announce micro-bot names", async () => {
  const bot = new MatrixBot({
    ...options,
    config: {
      announceSubBotUsage: true,
      selfDocumentation: false,
    },
  })
  const weather = new SubBot({ name: "weather", command: "!weather" })
  const current = new MicroBot({ name: "current", command: "current" })
  const notices: string[] = []

  current.use(async () => {})
  weather.use(current)
  bot.use(weather)

  await bot.dispatch(
    testRequest("!weather current delhi"),
    testResponse({
      async sendMarkdown(body) {
        notices.push(body)
      },
    }),
  )

  expect(notices).toEqual(["> using weather..."])
})

test("can explicitly disable sub-bot usage announcements", async () => {
  const bot = new MatrixBot(options)
  const ping = new SubBot({ name: "ping", command: "!ping" })
  const calls: string[] = []

  ping.use(async (_req, res) => {
    calls.push("handler")
    await res.replyText("pong")
  })
  bot.use(ping)

  const handled = await bot.dispatch(
    testRequest("!ping"),
    testResponse({
      async sendText(body) {
        calls.push(`send:${body}`)
      },
      async replyText(body) {
        calls.push(`reply:${body}`)
      },
    }),
  )

  expect(handled).toBe(1)
  expect(calls).toEqual(["handler", "reply:pong"])
})

test("logs sub-bot usage announcements", async () => {
  const logs: unknown[] = []
  const bot = new MatrixBot({
    ...options,
    config: {
      announceSubBotUsage: true,
      selfDocumentation: false,
    },
    logger(event) {
      logs.push(event)
    },
  })
  const ping = new SubBot({ name: "ping", command: "!ping" })

  ping.use(async () => {})
  bot.use(ping)

  await bot.dispatch(testRequest("!ping"), testResponse())

  expect(logs).toMatchObject([
    {
      level: "info",
      message: "Sub-bot usage announced",
      component: "dispatch",
      subBot: "ping",
    },
    {
      level: "info",
      message: "Matrix message dispatched",
      component: "dispatch",
      handled: 1,
    },
  ])
})

test("generates self-documentation from the mounted bot family", () => {
  const bot = new MatrixBot(options)
  const weather = new SubBot({
    name: "weather",
    command: ["!weather", "!w"],
    description: "Gets weather reports.",
    category: "Utility",
  })
  const current = new MicroBot({
    name: "current",
    command: ["current", "now"],
    description: "Gets current conditions.",
  })
  const watcher = new Ajent({
    name: "watcher",
    description: "Looks at every message.",
  })

  weather.use(current)
  bot.use(weather)
  bot.use(watcher)

  const markdown = bot.generateSelfDocumentation()

  expect(markdown).toContain("# Matrix Bot Family Tree")
  expect(markdown).toContain("-> weather (!weather, !w)")
  expect(markdown).toContain("-> current (current, now)")
  expect(markdown).toContain("-> watcher [ajent]")
  expect(markdown).toContain("Gets weather reports.")
  expect(markdown).toContain("Gets current conditions.")
  expect(markdown).toContain("Looks at every message.")
})

test("writes self-documentation to a markdown file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "matrix-bot-sdk-"))
  const path = join(dir, "family.md")
  try {
    const bot = new MatrixBot(options)
    bot.use(
      new SubBot({
        name: "ping",
        command: ["!ping", "!p"],
        description: "Replies with pong.",
      }),
    )

    await expect(bot.writeSelfDocumentation(path)).resolves.toBe(path)
    const markdown = await readFile(path, "utf8")

    expect(markdown).toContain("## Family Tree")
    expect(markdown).toContain("-> ping (!ping, !p)")
    expect(markdown).toContain("Replies with pong.")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("emits structured dispatch logs through the configured logger", async () => {
  const logs: unknown[] = []
  const bot = new MatrixBot({
    ...options,
    logger(event) {
      logs.push(event)
    },
  })
  const ping = new SubBot({ name: "ping", command: "!ping" })

  ping.use(async () => {})
  bot.use(ping)

  await bot.dispatch(testRequest("!ping"), testResponse())

  expect(logs).toMatchObject([
    {
      level: "info",
      message: "Matrix message dispatched",
      component: "dispatch",
      eventId: "$event",
      handled: 1,
    },
  ])
})

test("routes handler failures through the global error handler", async () => {
  const errors: string[] = []
  const logs: unknown[] = []
  const bot = new MatrixBot({
    ...options,
    logger(event) {
      logs.push(event)
    },
    onError({ error, phase, request }) {
      errors.push(`${phase}:${request?.eventId}:${(error as Error).message}`)
    },
  })
  const ping = new SubBot({ name: "ping", command: "!ping" })

  ping.use(async () => {
    throw new Error("boom")
  })
  bot.use(ping)

  const handled = await bot.dispatch(testRequest("!ping"), testResponse())

  expect(handled).toBe(0)
  expect(errors).toEqual(["dispatch:$event:boom"])
  expect(logs).toEqual([])
})

test("normalizes a relative string path into a media attachment", async () => {
  const attachment = await normalizeMediaAttachment("package.json")

  expect(attachment.filename).toBe("package.json")
  expect(attachment.contentType).toBe("application/json")
  expect(Buffer.from(attachment.data).toString()).toContain("matrix-bot-sdk-workspace")
})

test("normalizes path attachment options without forcing callers to read bytes", async () => {
  const attachment = await normalizeMediaAttachment(
    {
      path: "README.md",
      filename: "manual.md",
    },
    "file",
  )

  expect(attachment.filename).toBe("manual.md")
  expect(attachment.contentType).toBe("text/markdown")
  expect(Buffer.from(attachment.data).toString()).toContain("# matrix-bot-sdk")
})

function testRequest(body: string) {
  return {
    eventId: "$event",
    roomId: "!room:example.org",
    sender: "@user:example.org",
    messageType: "text" as const,
    rawBody: body,
    body,
    replyUnsupported: false,
  }
}

function testResponse(overrides: Partial<MatrixResponse> = {}): MatrixResponse {
  return {
    async sendText() {},
    async sendMarkdown() {},
    async sendMedia() {},
    async sendImage() {},
    async sendFile() {},
    async sendVideo() {},
    async sendPoll() {},
    async replyText() {},
    async replyMarkdown() {},
    async downloadMedia() {
      return Buffer.from("")
    },
    ...overrides,
  }
}
