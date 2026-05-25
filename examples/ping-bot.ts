import { MatrixBot } from "../js/src/index"

const admin = requiredList("BOT_ADMINS")

const bot = new MatrixBot({
  homeserverUrl: required("HOMESERVER_URL"),
  username: required("BOT_USERNAME"),
  password: required("BOT_PASSWORD"),
  recoveryKey: required("RECOVERY_KEY"),
  dataDir: Bun.env.DATA_DIR ?? ".matrix-bot-sdk",
  config: {
    announceCommandGroupUsage: true,
    selfDocumentation: true,
  },
  admin,
  timelineLimit: Number(Bun.env.TIMELINE_LIMIT ?? 20),
})

bot.command(["!ping", "!p"], async (ctx) => {
  await ctx.reply.text("pong")
})

bot.start(() => {
  console.log("Ping bot is ready!")
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
