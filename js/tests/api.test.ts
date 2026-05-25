import { describe, expect, test } from "bun:test"
import { MatrixBot, CommandGroup, Command, Context, ListenerEvent } from "../src/index"

function createMockContext(overrides: any = {}): Context {
  const body = overrides.body ?? "hello"
  const msgOverrides = overrides.message ?? {}
  return {
    message: {
      id: "1",
      type: "text",
      rawBody: body,
      body: body,
      ...msgOverrides,
    },
    room: {
      id: "1",
      isDirect: false,
      ...(overrides.room ?? {}),
    },
    sender: {
      id: "@user:example.com",
      isAdmin: () => false,
      isModerator: () => false,
      ...(overrides.sender ?? {}),
    },
    send: {
      text: async () => {},
      markdown: async () => {},
      media: async () => {},
      image: async () => {},
      file: async () => {},
      video: async () => {},
      poll: async () => {},
    },
    reply: {
      text: async () => {},
      markdown: async () => {},
    },
    downloadMedia: async () => Buffer.from([]),
    ...overrides,
  } as any as Context
}

describe("MatrixBot Fluent API", () => {
  test("bot.command handles commands", async () => {
    let called = false
    const bot = new MatrixBot({
      homeserverUrl: "http://localhost",
      username: "user",
      password: "password",
      recoveryKey: "key",
    })

    bot.command("!ping", async (ctx) => {
      called = true
    })

    await bot.dispatch(createMockContext({ body: "!ping" }))
    expect(called).toBe(true)
  })

  test("bot.group handles prefixed commands", async () => {
    let called = false
    const bot = new MatrixBot({
      homeserverUrl: "http://localhost",
      username: "user",
      password: "password",
      recoveryKey: "key",
    })

    const group = bot.group("!admin")
    group.command("status", async (ctx) => {
      called = true
    })

    await bot.dispatch(createMockContext({ body: "!admin status" }))
    expect(called).toBe(true)
  })

  test("bot.on handles matrix events", async () => {
    let called = false
    const bot = new MatrixBot({
      homeserverUrl: "http://localhost",
      username: "user",
      password: "password",
      recoveryKey: "key",
    })

    bot.on("message", async (ctx) => {
      called = true
    })

    await bot.dispatchListeners(
      {
        id: "test-1",
        kind: "matrix.message",
        source: "matrix",
        request: createMockContext(),
        timestamp: new Date(),
      },
      { matrix: undefined }
    )
    expect(called).toBe(true)
  })

  test("middleware execution order", async () => {
    const order: number[] = []
    const bot = new MatrixBot({
      homeserverUrl: "http://localhost",
      username: "user",
      password: "password",
      recoveryKey: "key",
    })

    bot.command(
      "!test",
      async (ctx, next) => {
        order.push(1)
        await next()
        order.push(4)
      },
      async (ctx, next) => {
        order.push(2)
        await next()
        order.push(3)
      },
      async (ctx) => {
        order.push(5)
      }
    )

    await bot.dispatch(createMockContext({ body: "!test" }))
    expect(order).toEqual([1, 2, 5, 3, 4])
  })
})
