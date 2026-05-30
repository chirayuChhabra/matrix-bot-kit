# Getting Started

## Prerequisites

Ensure you have the following installed:
- [Bun](https://bun.sh/)
- [Rust & Cargo](https://rustup.rs/) (to compile the native backend)

## Installation

1. Clone your project repository.
2. Build the native binding:
   ```bash
   devbox run build-native
   # Or manually compile crates and place the .node file at:
   # js/native/matrix_bot_node.node
   ```

## Your First Bot

```ts
import { MatrixBot, type Context } from "../matrix-bot-sdk/js/src/index"

const bot = new MatrixBot({
  homeserverUrl: "https://matrix.org",
  username: Bun.env.BOT_USERNAME!,
  password: Bun.env.BOT_PASSWORD!,
  recoveryKey: Bun.env.RECOVERY_KEY!,
  admin: [Bun.env.MAINTAINER_ID!],
  timelineLimit: 20,
  config: {
    announceCommandGroupUsage: true,
    utility: true, 
  },
})

// Simple echo command
bot.command("!echo", async (ctx: Context) => {
  await ctx.reply.text(ctx.message.body)
})

await bot.start(() => {
  console.log("Bot successfully started and syncing")
})
```
