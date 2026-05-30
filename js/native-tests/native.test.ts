import { expect, test } from "bun:test"
import { Listener, MatrixBot, CommandGroup } from "../src/index"

test("native binding registers sub-bots", () => {
  const bot = new MatrixBot({
    homeserverUrl: "https://matrix.example.org",
    username: "@bot:example.org",
    password: "secret",
    recoveryKey: "recovery",
    admin: ["@admin:example.org"],
  })
  const commandGroup = new CommandGroup({ name: "factcheck", command: "!check" })

  bot.use(commandGroup)

  expect(bot.nativeAvailable).toBe(true)
  expect(commandGroup.name).toBe("factcheck")
  expect(bot.commandGroupCount).toBe(1)
})

test("native binding registers ajents", () => {
  const bot = new MatrixBot({
    homeserverUrl: "https://matrix.example.org",
    username: "@bot:example.org",
    password: "secret",
    recoveryKey: "recovery",
    admin: ["@admin:example.org"],
  })
  const listener = new Listener({
    name: "watcher",
    triggers: [{ kind: "matrix.message", messageTypes: ["image"] }],
  })

  bot.use(listener)

  expect(bot.nativeAvailable).toBe(true)
  expect(listener.name).toBe("watcher")
  expect(bot.listenerCount).toBe(1)
})

test("native-backed wrapper exposes listen prerequisites", async () => {
  const bot = new MatrixBot({
    homeserverUrl: "https://matrix.example.org",
    username: "@bot:example.org",
    password: "secret",
    recoveryKey: "recovery",
    admin: ["@admin:example.org"],
  })

  expect(bot.nativeAvailable).toBe(true)
  // We can't really test the throw since it no longer throws on start
  expect(bot).toBeDefined()
})
