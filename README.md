# matrix-bot-sdk

Rust-backed SDK for building Matrix bots from Bun/TypeScript with an Express-style routing model.

The Matrix runtime is written in Rust and handles login, session restore, E2EE recovery, sync, reply extraction, and sending messages. Your bot logic stays in TypeScript as `SubBot` modules with middleware and handlers.

## Current Status

This SDK is usable locally from this repository. It is not published or packaged for npm yet.

Working today:

- `MatrixBot` root bot instance.
- `SubBot` feature modules.
- String, regex, and function route matchers.
- Middleware with `next()`.
- Matrix login and session restore.
- E2EE recovery through recovery key.
- Owner-only invite acceptance.
- Bounded Matrix sync backlog.
- Text message extraction.
- Reply target extraction for text, notice, and server notice events.
- Plain text and Markdown send/reply helpers.

Still rough:

- Native binary is built locally with `devbox run build-native`.
- Import path is local unless you wire this repo as a workspace dependency.
- No npm package publishing or platform binary packaging yet.
- Real homeserver behavior should be tested with your bot account.

## Build And Test

```sh
devbox run build-native
devbox run test
devbox run test-js
devbox run test-native
```

The native build creates:

```text
js/native/matrix_bot_node.node
```

## Quick Start

For Matrix.org accounts, use:

```text
https://matrix.org
```

Example:

```ts
import { MatrixBot, SubBot } from "../matrix-bot-sdk/js/src/index"

const bot = new MatrixBot({
  homeserverUrl: "https://matrix.org",
  username: Bun.env.BOT_USERNAME!,
  password: Bun.env.BOT_PASSWORD!,
  recoveryKey: Bun.env.RECOVERY_KEY!,
})

const ping = new SubBot("ping")

ping.use("!ping", async (ctx) => {
  await ctx.replyText("pong")
})

bot.use(ping)

await bot.listen({
  owners: [Bun.env.MAINTAINER_ID!],
})
```

Before running a project that imports this SDK locally:

```sh
cd /Users/chirayu/Developer/matrix-bot-sdk
devbox run build-native
```

## Runnable Example

```sh
export HOMESERVER_URL="https://matrix.org"
export BOT_USERNAME="@yourbot:matrix.org"
export BOT_PASSWORD="..."
export RECOVERY_KEY="..."
export BOT_OWNERS="@you:matrix.org"

devbox run build-native
devbox run example
```

The example lives at [examples/ping-bot.ts](examples/ping-bot.ts).

## API

### `new MatrixBot(options)`

Creates the root bot.

```ts
const bot = new MatrixBot({
  homeserverUrl: "https://matrix.org",
  username: "@bot:matrix.org",
  password: "...",
  recoveryKey: "...",
  dataDir: ".matrix-bot-sdk",
})
```

Options:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `homeserverUrl` | `string` | Yes | Matrix homeserver URL, for example `https://matrix.org`. |
| `username` | `string` | Yes | Bot Matrix user id or login username. |
| `password` | `string` | Yes | Bot account password. |
| `recoveryKey` | `string` | Yes | Matrix E2EE recovery key. |
| `dataDir` | `string` | No | Where session/store/cache files live. Defaults inside the SDK config path. |

### `bot.use(subBot)`

Mounts a `SubBot`.

```ts
bot.use(factCheckBot)
bot.use(imdbBot)
```

Sub-bot names must be unique.

### `bot.listen(options)`

Starts the Matrix runtime and keeps the process alive.

```ts
await bot.listen({
  owners: ["@you:matrix.org"],
  timelineLimit: 20,
})
```

Options:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `owners` | `string[]` | Yes | Users allowed to invite the bot into rooms. |
| `timelineLimit` | `number` | No | Per-room sync backlog cap. Defaults to `20`. |
| `controlPassword` | `string` | No | Reserved for admin controls. Not fully wired yet. |

### `bot.dispatch(ctx)`

Runs all matching mounted sub-bots against a context. Mainly useful for tests.

```ts
const handled = await bot.dispatch(ctx)
```

Returns the number of matched routes.

### `bot.nativeAvailable`

Boolean. `true` when `js/native/matrix_bot_node.node` was found.

### `bot.subBotCount`

Number of mounted sub-bots. Uses the native count when native is loaded.

## SubBot API

### `new SubBot(name)`

Creates a named module.

```ts
const factCheckBot = new SubBot("factcheck")
```

### `subBot.use(matcher, ...middleware, handler)`

Registers a route.

```ts
factCheckBot.use("!check", authMiddleware, async (ctx) => {
  await ctx.replyMarkdown("**Verdict:** Unverified")
})
```

The last function is the handler. Any functions before it are middleware.

### `subBot.dispatch(ctx)`

Runs matching routes for this sub-bot. Mainly useful for tests.

## Route Matchers

### String Prefix

String matchers use `startsWith`.

```ts
bot.use(new SubBot("ping").use("!ping", async (ctx) => {
  await ctx.replyText("pong")
}))
```

This matches:

```text
!ping
!ping hello
```

### Regular Expression

```ts
imdbBot.use(/^!imdb\s+(.+)/, async (ctx) => {
  const query = ctx.body.replace(/^!imdb\s+/, "")
  await ctx.replyText(`Searching IMDb for ${query}`)
})
```

### Function Matcher

```ts
const replyToBot = (ctx) => Boolean(ctx.repliedMessage)

followupBot.use(replyToBot, async (ctx) => {
  await ctx.replyText("I saw your reply.")
})
```

Unsupported reply target fallback:

```ts
bot.use(
  (ctx) => ctx.replyUnsupported,
  async (ctx) => {
    await ctx.replyText("this feature willcome sson")
  },
)
```

## Middleware

Middleware receives `(ctx, next)`.

```ts
const ownerOnly = (owners: string[]) => {
  return async (ctx, next) => {
    if (!owners.includes(ctx.sender)) {
      await ctx.replyText("Not allowed.")
      return
    }

    await next()
  }
}

factCheckBot.use("!check", ownerOnly(["@you:matrix.org"]), async (ctx) => {
  await ctx.replyText("checking")
})
```

Middleware can run code before and after the handler:

```ts
const timing = async (ctx, next) => {
  const started = Date.now()
  await next()
  console.log(`${ctx.eventId} took ${Date.now() - started}ms`)
}
```

Calling `next()` more than once throws.

## Handler Context

Every handler and middleware receives `ctx`.

```ts
type MatrixContext = {
  eventId: string
  roomId: string
  sender: string
  body: string
  repliedMessage?: RepliedMessage
  replyUnsupported: boolean
  sendText(body: string): Promise<void>
  sendMarkdown(body: string): Promise<void>
  replyText(body: string): Promise<void>
  replyMarkdown(body: string): Promise<void>
}
```

### `ctx.eventId`

The incoming Matrix event id.

### `ctx.roomId`

The Matrix room id where the message arrived.

### `ctx.sender`

The Matrix user id of the sender.

```ts
if (ctx.sender === "@you:matrix.org") {
  await ctx.replyText("hello owner")
}
```

### `ctx.body`

Trimmed text body from the incoming message.

```ts
const claim = ctx.body.replace(/^!check\s*/, "")
```

### `ctx.repliedMessage`

Present when the incoming message replied to a text-like event.

```ts
factCheckBot.use("!check", async (ctx) => {
  const claim = ctx.body === "!check"
    ? ctx.repliedMessage?.body
    : ctx.body.replace(/^!check\s*/, "")

  if (!claim) {
    await ctx.replyText("Usage: !check <claim>")
    return
  }

  await ctx.replyMarkdown(`**Claim:** ${claim}`)
})
```

Shape:

```ts
type RepliedMessage = {
  eventId: string
  sender: string
  body: string
}
```

The Rust runtime currently extracts replied text from:

- `m.text`
- `m.notice`
- `m.server_notice`

### `ctx.replyUnsupported`

`true` when the incoming message was a reply, but the replied-to event was not usable text.

```ts
if (ctx.replyUnsupported) {
  await ctx.replyText("this feature willcome sson")
}
```

### `ctx.sendText(body)`

Sends a plain Matrix notice to the room. It is not threaded as a reply.

```ts
await ctx.sendText("Checking...")
```

### `ctx.sendMarkdown(body)`

Sends a Markdown Matrix notice to the room.

```ts
await ctx.sendMarkdown("**Checking...**")
```

### `ctx.replyText(body)`

Replies to the incoming event with a plain Matrix notice.

```ts
await ctx.replyText("pong")
```

### `ctx.replyMarkdown(body)`

Replies to the incoming event with Matrix-rendered Markdown.

```ts
await ctx.replyMarkdown("**Verdict:** Unverified")
```

## Practical Bot Patterns

### Immediate Acknowledgement

For slow handlers, send a plain room notice first.

```ts
factCheckBot.use("!check", async (ctx) => {
  await ctx.sendText("Checking...")
  const answer = await factCheck(ctx.body)
  await ctx.replyMarkdown(answer)
})
```

### Reply-Based Command

```ts
factCheckBot.use("!check", async (ctx) => {
  const inlineClaim = ctx.body.replace(/^!check\s*/, "").trim()
  const claim = inlineClaim || ctx.repliedMessage?.body

  if (!claim) {
    await ctx.replyText("Usage: !check <claim>")
    return
  }

  await ctx.sendText("Checking...")
  await ctx.replyMarkdown(await factCheck(claim))
})
```

### Multiple Sub-Bots

```ts
const factCheckBot = new SubBot("factcheck")
const imdbBot = new SubBot("imdb")

factCheckBot.use("!check", factCheckHandler)
imdbBot.use("!imdb", imdbHandler)

bot.use(factCheckBot)
bot.use(imdbBot)
```

## Local Project Import

Until package publishing is added, import from the local repo:

```ts
import { MatrixBot, SubBot } from "../matrix-bot-sdk/js/src/index"
```

Build the native binding in the SDK repo first:

```sh
cd /Users/chirayu/Developer/matrix-bot-sdk
devbox run build-native
```

## Environment Variables Used By The Example

| Variable | Meaning |
| --- | --- |
| `HOMESERVER_URL` | Homeserver URL, for example `https://matrix.org`. |
| `BOT_USERNAME` | Bot Matrix user id or username. |
| `BOT_PASSWORD` | Bot account password. |
| `RECOVERY_KEY` | E2EE recovery key. |
| `BOT_OWNERS` | Comma-separated owner user ids allowed to invite the bot. |
| `DATA_DIR` | Optional data directory. |
| `TIMELINE_LIMIT` | Optional sync backlog limit. Defaults to `20`. |

## Notes

- The SDK sends Matrix notices, not normal user text messages.
- `replyMarkdown` and `sendMarkdown` require the Rust runtime build with Matrix markdown support, which is enabled here.
- `listen()` intentionally does not resolve while the bot is running.
- Native runtime errors during startup currently print to stderr from the Rust runtime thread.
- `controlPassword` is reserved but not implemented as a full admin command system yet.
