import { expect, test } from "bun:test"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const native = require("../native/matrix_bot_node.node")

test("native binding registers sub-bots", () => {
  const bot = new native.MatrixBot({
    homeserverUrl: "https://matrix.example.org",
    username: "@bot:example.org",
    password: "secret",
    recoveryKey: "recovery",
  })
  const subBot = new native.SubBot("factcheck")

  bot.registerSubBot(subBot)

  expect(subBot.name).toBe("factcheck")
  expect(bot.subBotCount).toBe(1)
})
