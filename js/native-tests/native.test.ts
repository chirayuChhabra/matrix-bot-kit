import { expect, test } from "bun:test"
import { MatrixBot, SubBot } from "../src/index"

test("native binding registers sub-bots", () => {
  const bot = new MatrixBot({
    homeserverUrl: "https://matrix.example.org",
    username: "@bot:example.org",
    password: "secret",
    recoveryKey: "recovery",
  })
  const subBot = new SubBot("factcheck")

  bot.use(subBot)

  expect(bot.nativeAvailable).toBe(true)
  expect(subBot.name).toBe("factcheck")
  expect(bot.subBotCount).toBe(1)
})
