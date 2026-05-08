import {
  MatrixBot,
  SubBot,
  type MatrixRequest,
  type MatrixResponse,
} from "../js/src/index"

const bot = new MatrixBot({
  homeserverUrl: required("HOMESERVER_URL"),
  username: required("BOT_USERNAME"),
  password: required("BOT_PASSWORD"),
  recoveryKey: required("RECOVERY_KEY"),
  dataDir: Bun.env.DATA_DIR ?? ".matrix-bot-sdk",
  config: {
    announceSubBotUsage: true,
    selfDocumentation: true,
  },
})

const ping = new SubBot({
  name: "ping",
  command: ["!ping", "!p"],
  description: "Replies with pong.",
  category: "Utility",
})

ping.use(async (_req: MatrixRequest, res: MatrixResponse) => {
  await res.replyText("pong")
})

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
