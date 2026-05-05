# matrix-bot-sdk

Rust-first SDK for building Matrix bots with a backend-style routing model.

This repository is intentionally being built in small commits. The first module is the Rust core crate that owns stable SDK concepts:

- `MatrixBotConfig` for homeserver/login/recovery configuration.
- `MatrixBot` for the root bot instance.
- `SubBot` for named feature modules like `factcheck` and `imdb`.

The next layer will expose this core to Bun/TypeScript through a native binding.

Build checks:

```sh
devbox run test
devbox run test-js
devbox run build-native
devbox run test-native
```

Target TypeScript API:

```ts
import { MatrixBot, SubBot } from "matrix-bot-sdk"

const bot = new MatrixBot({
  homeserverUrl: Bun.env.HOMESERVER_URL!,
  username: Bun.env.BOT_USERNAME!,
  password: Bun.env.BOT_PASSWORD!,
  recoveryKey: Bun.env.RECOVERY_KEY!,
})

const factCheckBot = new SubBot("factcheck")
factCheckBot.use("!check", async (ctx) => {
  await ctx.replyMarkdown("**Verdict:** Unverified")
})

bot.use(factCheckBot)

await bot.listen({
  owners: [Bun.env.MAINTAINER_ID!],
  controlPassword: Bun.env.CONTROL_PASSWORD,
})
```
