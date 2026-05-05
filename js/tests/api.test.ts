import { expect, test } from "bun:test"
import { MatrixBot, SubBot } from "../src/index"

const options = {
  homeserverUrl: "https://matrix.example.org",
  username: "@bot:example.org",
  password: "secret",
  recoveryKey: "recovery",
}

test("registers sub-bots in mount order", () => {
  const bot = new MatrixBot(options)
  const factcheck = new SubBot("factcheck")
  const imdb = new SubBot("imdb")

  bot.use(factcheck).use(imdb)

  expect(bot.subBots.map((subBot) => subBot.name)).toEqual(["factcheck", "imdb"])
})

test("stores route middleware before handler", () => {
  const subBot = new SubBot("factcheck")
  const ownerOnly = async (_ctx: never, next: () => Promise<void>) => next()
  const handler = async () => {}

  subBot.use("!check", ownerOnly, handler)

  expect(subBot.routes).toHaveLength(1)
  expect(subBot.routes[0].middleware).toEqual([ownerOnly])
  expect(subBot.routes[0].handler).toBe(handler)
})

test("rejects duplicate sub-bot names", () => {
  const bot = new MatrixBot(options)

  bot.use(new SubBot("factcheck"))

  expect(() => bot.use(new SubBot("factcheck"))).toThrow(
    "a sub-bot named `factcheck` is already registered",
  )
})
