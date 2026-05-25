# 🤖 Matrix Bot SDK

> **Build high-performance, resilient Matrix bots with ease.**

The **Matrix Bot SDK** combines the rock-solid reliability of a **Rust runtime** with the flexibility and expressiveness of **Bun/TypeScript**. 

You focus on your bot's behavior in TypeScript, while the Rust backend seamlessly handles the heavy lifting: Matrix syncing, secure logins, End-to-End Encryption (E2EE), invite handling, message parsing, and polling.

---

## ✨ Features

- **Hybrid Architecture:** Rust handles Matrix syncing, crypto, and connection pooling; TypeScript handles the logic.
- **E2EE First:** Native support for end-to-end encryption with recovery keys.
- **Advanced Routing:** Robust routing for commands, sub-commands, and middleware.
- **Autonomous Listeners:** Schedule tasks, handle webhooks, or process all incoming events automatically.
- **Rich Media & Polls:** Helpers for sending/receiving images, files, videos, and polls.
- **Utility Commands:** Built-in maintainer commands (`!ping`, `!status`, `!maintenance`) out of the box.
- **Self-Documenting:** Automatically generate a Markdown family tree of your bot's capabilities.
- **Zero-Boilerplate Errors:** Global error hooks for easy operational monitoring.

---

## 🧠 Mental Model

The SDK is organized hierarchically. You instantiate a `MatrixBot`, attach `CommandGroup`s or `Listener`s, and mount `Command`s.

```text
MatrixBot
  ├── CommandGroup (e.g., `!weather`)
  │    └── Command (e.g., `current`, `forecast`)
  ├── Command      (e.g., `!ping` - simple top-level command)
  └── Listener     (Autonomous event-driven bot, no command prefix required)
```

- **Commands** (`bot.command`, `bot.group`): Triggered by specific prefixes or text patterns.
- **Listeners** (`bot.on`, `bot.schedule`, `bot.webhook`): Wake up based on events—every Matrix message, image uploads, scheduled cron ticks, or external webhooks (e.g., Stripe).

---

## 🚀 Getting Started

### Prerequisites
- [Bun](https://bun.sh/)
- [Rust & Cargo](https://rustup.rs/) (to build the native backend)

### Installation

1. Clone your project repository.
2. Build the native binding:
   ```bash
   devbox run build-native
   # or manually compile the crates and place the .node file at:
   # js/native/matrix_bot_node.node
   ```

### Your First Bot

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
    announceCommandGroupUsage: true, // Announce when a group command is used
    utility: true, // Enable built-in utility & maintenance commands
  },
})

// Simple ping command
bot.command(["!ping", "!p"], async (ctx: Context) => {
  await ctx.reply.text("pong")
})

// Start syncing
await bot.start(() => {
  console.log("Bot successfully started and syncing!")
})
```

---

## 📚 Core Concepts

### Commands & Routing

A **Command Group** acts as a feature boundary. If a feature has one natural action, use `bot.command`:

```ts
bot.command(["!weather", "!w"], async (ctx) => {
  await ctx.reply.text(`Weather for ${ctx.message.body}`)
})
```

If a feature has multiple sub-actions, use a group:

```ts
const weather = bot.group(["!weather", "!w"])

weather.command(["current", "now"], async (ctx) => {
  await ctx.reply.text(`Current weather for ${ctx.message.body}`)
})

weather.command("forecast", async (ctx) => {
  await ctx.reply.text(`Weather forecast for ${ctx.message.body}`)
})
```
*Note: Routing consumes tokens as it goes. For `!weather current delhi`, `ctx.message.body` resolves to just `delhi` inside the handler.*

### Listeners (Event-driven)

Listeners do not require a command prefix. They are activated by raw events.

**Matrix Events:**
```ts
bot.on("image", async (ctx) => {
  await ctx.reply.text(`Processing your image: ${ctx.message.media?.filename}`)
})
```

**Scheduled Tasks:**
```ts
bot.schedule({ everyMs: 24 * 60 * 60 * 1000 }, async (event) => {
  console.log("Running daily digest...")
})
```

**External Webhooks:**
```ts
bot.webhook("stripe", "payment.succeeded", async (event) => {
  console.log("paid", event.payload)
})

// Somewhere else in your API server:
await bot.emitExternal("stripe", "payment.succeeded", { sessionId: "123" })
```

### Middleware

Wrap handlers to enforce global rules, like restricting commands to a specific domain:

```ts
const restrictToDomain = (domain: string) => {
  return async (ctx: Context, next: () => Promise<void>) => {
    if (!ctx.sender.id.endsWith(`:${domain}`)) {
      await ctx.reply.text("Not allowed from your domain.")
      return
    }
    await next()
  }
}

bot.command("!internal", restrictToDomain("company.org"), async (ctx) => {
  await ctx.reply.text("Top secret internal data.")
})
```

### Contextual Replies

You can inspect the message that a user replied to.

```ts
bot.command("!ping", async (ctx) => {
  if (!ctx.message.reply?.target) {
    return ctx.reply.text("pong")
  }
  await ctx.reply.text(`pong for ${ctx.message.reply.target.sender}'s message`)
})
```

### Media & Polls

Incoming media is normalized onto `ctx.message.media`.

```ts
bot.command("!image", async (ctx) => {
  if (ctx.message.type !== "image" || !ctx.message.media) return
  const bytes = await ctx.downloadMedia()
  await ctx.reply.text(`Downloaded ${bytes.length} bytes`)
})
```

Send media or polls seamlessly:
```ts
await ctx.send.image("./result.png")
await ctx.send.video("./clip.mp4")
await ctx.send.file("./report.pdf")

await ctx.send.poll({
  question: "Ship it?",
  answers: [{ id: "yes", text: "Yes" }, { id: "no", text: "No" }],
})
```

---

## 🛠 Advanced Features

### Built-in Utility Commands

Set `config: { utility: true }` in your `MatrixBot` constructor to instantly unlock powerful maintainer commands. 

- **Public Commands:**
  - `!help`: Generates a Markdown-formatted map of all available commands and groups.
- **Admin-Only Commands (Direct Messages only):**
  - `!ping`: Responds with "pong".
  - `!uptime`: Outputs the bot process uptime.
  - `!version`: Outputs the bot version (from `package.json`).
  - `!status`: Aggregates uptime, memory usage, and command/listener counts.
- **Password-Protected Maintainer Commands:**
  *(Requires `MAINTENANCE_PASSWORD` in your environment)*
  - `!maintenance <password>`: Toggles maintenance mode. When active, all non-maintenance commands are intercepted and the bot politely replies that it is under maintenance.
  - `!reload <password>`: Triggers a graceful rebuild and restart by executing `scripts/reload.sh`.
  - `!shutdown <password>`: Initiates a graceful process exit.

### Self-Documentation

When `config.selfDocumentation` is enabled, the bot dynamically writes a `matrix-bot-family.md` file charting its entire capability tree.

```ts
const bot = new MatrixBot({
  // ...
  config: {
    selfDocumentation: true,
    documentationPath: "docs/bot-family.md",
  },
})
```

---

## ⚙️ API Reference

### MatrixBotOptions

| Option | Required | Description |
| --- | --- | --- |
| `homeserverUrl` | Yes | Matrix homeserver URL (e.g. `https://matrix.org`). |
| `username` | Yes | Bot Matrix user id or login username. |
| `password` | Yes | Bot account password. |
| `recoveryKey` | Yes | Matrix E2EE recovery key. |
| `admin` | No | Users allowed to invite the bot and use admin-only commands. |
| `moderator` | No | Users with moderator permissions. Admins implicitly inherit these rights. |
| `timelineLimit` | No | Per-room sync backlog cap. Defaults to `20`. |
| `dataDir` | No | Session, store, and cache directory. Defaults to `.matrix-bot-sdk`. |
| `config.announceCommandGroupUsage` | No | Sends `> using <group>...` before running a matched group. |
| `config.selfDocumentation` | No | Writes bot family Markdown when `start()` runs. |
| `config.utility` | No | Activates built-in maintainer/utility commands. |
| `logger` | No | Production log sink. |
| `onError` | No | Global runtime or dispatch error hook. |

### Context Object

The `Context` object encapsulates everything you need for a given event:

```ts
type Context = {
  message: {
    id: string
    type: "text" | "notice" | "server_notice" | "image" | "file" | "video" | "poll"
    rawBody: string  // Original text
    body: string     // Text after route consumption
    media?: MediaMessage
    poll?: PollMessage
    reply?: { target?: RepliedMessage; isUnsupported: boolean }
  }
  room: { id: string; isDirect: boolean }
  sender: {
    id: string
    isAdmin(userId?: string): boolean
    isModerator(userId?: string): boolean
  }
  send: {
    text(body: string): Promise<void>
    markdown(body: string): Promise<void>
    media(kind: "image" | "file" | "video", attachment: MediaAttachment): Promise<void>
    image(attachment: MediaAttachment): Promise<void>
    file(attachment: MediaAttachment): Promise<void>
    video(attachment: MediaAttachment): Promise<void>
    poll(poll: OutboundPoll): Promise<void>
  }
  reply: {
    text(body: string): Promise<void>
    markdown(body: string): Promise<void>
  }
  downloadMedia(target?: string | { roomId?: string; eventId?: string }): Promise<Buffer>
}
```

---

## 🛡 Logging & Error Handling

Provide a custom logger or rely on the structured default JSON logger.

```ts
const bot = new MatrixBot({
  // ...
  logger(event) {
    process.stdout.write(`${JSON.stringify(event)}\n`)
  },
  async onError({ error, phase, request }) {
    console.error(`Error in ${phase}:`, error)
    // Send alert to ops, log to Datadog, etc.
  }
})
```

Handler errors are safely caught at the dispatch boundary, ensuring your bot's sync loop is never interrupted.

---

*Note: This repository is usable locally but is not currently packaged for npm. Package publishing and platform binary distribution are planned.*
