import { MatrixBot, SubBot } from "../js/src/index"

const bot = new MatrixBot({
  homeserverUrl: required("HOMESERVER_URL"),
  username: required("BOT_USERNAME"),
  password: required("BOT_PASSWORD"),
  recoveryKey: required("RECOVERY_KEY"),
  dataDir: Bun.env.DATA_DIR ?? ".matrix-bot-sdk",
})

const ping = new SubBot("ping")

ping.use("!ping", async (ctx) => {
  await ctx.replyText("pong")
})

ping.use(
  (ctx) => ctx.replyUnsupported,
  async (ctx) => {
    await ctx.replyText("this feature willcome sson")
  },
)

bot.use(ping)

await bot.listen({
  owners: requiredList("BOT_OWNERS"),
  timelineLimit: Number(Bun.env.TIMELINE_LIMIT ?? 20),
})

function required(name: string): string {
  const value = Bun.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

function requiredList(name: string): string[] {
  return required(name)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
}
