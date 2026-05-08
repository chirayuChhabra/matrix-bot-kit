import { expect, test } from "bun:test"
import { MatrixBot, SubBot } from "../src/index"

test("native binding registers sub-bots", () => {
  const bot = new MatrixBot({
    homeserverUrl: "https://matrix.example.org",
    username: "@bot:example.org",
    password: "secret",
    recoveryKey: "recovery",
  })
  const subBot = new SubBot({ name: "factcheck", command: "!check" })

  bot.use(subBot)

  expect(bot.nativeAvailable).toBe(true)
  expect(subBot.name).toBe("factcheck")
  expect(bot.subBotCount).toBe(1)
})

test("native-backed wrapper exposes listen prerequisites", async () => {
  const bot = new MatrixBot({
    homeserverUrl: "https://matrix.example.org",
    username: "@bot:example.org",
    password: "secret",
    recoveryKey: "recovery",
  })

  expect(bot.nativeAvailable).toBe(true)
  await expect(bot.listen({ owners: [] })).rejects.toThrow("owners is required")
})
