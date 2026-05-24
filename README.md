# matrix-bot-sdk

Rust runtime, Bun/TypeScript bot logic.

This SDK is for building Matrix bots without writing Matrix sync, login, E2EE, invite handling, replies, uploads, or polling code yourself. Rust owns the Matrix runtime. TypeScript owns your bot behavior.

The mental model is:

```text
MatrixBot
  -> SubBot      main command or feature, like !ping or !weather
      -> MicroBot optional subcommand, like current or forecast
  -> Ajent       autonomous event-driven bot, no command required
```

Use a `SubBot` directly for simple commands. Use `MicroBot` only when the command has subcommands.
Use an `Ajent` when the bot should wake up from an event instead of a command: every Matrix
message, images only, scheduled ticks, or an external event such as a Stripe webhook.

## Status

This repository is usable locally, but it is not packaged for npm yet.

What works:

- Matrix login and session restore.
- E2EE recovery with a recovery key.
- Owner-only invite acceptance.
- Bounded sync backlog.
- Rust-side command prefiltering before events cross into Bun.
- Ajents for autonomous message, schedule, and external-source workflows.
- Text, reply, media, and poll receive metadata.
- Plain text, Markdown, media, and poll send helpers.
- Middleware.
- Structured production logging.
- One global error hook.

Still rough:

- You must build the native binding locally.
- Import paths are local repo paths until packaging exists.
- Admin command helpers are not built in yet.

## Setup

Build the native binding first:

```sh
devbox run build-native
```

That creates:

```text
js/native/matrix_bot_node.node
```

Run tests:

```sh
devbox run test
devbox run test-js
devbox run test-native
```

## Smallest Bot

```ts
import {
  MatrixBot,
  SubBot,
  type MatrixRequest,
  type MatrixResponse,
} from "../matrix-bot-sdk/js/src/index"

const bot = new MatrixBot({
  homeserverUrl: "https://matrix.org",
  username: Bun.env.BOT_USERNAME!,
  password: Bun.env.BOT_PASSWORD!,
  recoveryKey: Bun.env.RECOVERY_KEY!,
  config: {
    announceSubBotUsage: true,
    selfDocumentation: true,
  },
})

const ping = new SubBot({
  name: "ping",
  command: ["!ping", "!p"],
})

ping.use(async (_req: MatrixRequest, res: MatrixResponse) => {
  await res.replyText("pong")
})

bot.use(ping)

await bot.listen({
  owners: [Bun.env.MAINTAINER_ID!],
})
```

User sends:

```text
!ping
```

Bot replies:

```text
pong
```

## Ajents

Ajents are autonomous bots. They do not require a command. They are activated by events and receive
the message content, media metadata, poll metadata, reply metadata, or external payload that caused
the activation.

```ts
import { Ajent, MatrixBot } from "../matrix-bot-sdk/js/src/index"

const bot = new MatrixBot({
  homeserverUrl,
  username,
  password,
  recoveryKey,
})

const watcher = new Ajent({
  name: "room-watcher",
  triggers: ["matrix.message"],
})

watcher.use(async (event, actions) => {
  const req = event.request
  if (!req) {
    return
  }

  if (req.media?.kind === "image") {
    await actions.matrix?.replyText(`I saw image ${req.media.filename}`)
  }
})

bot.use(watcher)
```

Ajents can filter Matrix messages:

```ts
const imageIndexer = new Ajent({
  name: "image-indexer",
  triggers: [{ kind: "matrix.message", messageTypes: ["image"] }],
})
```

They can also react to external sources. A web server or webhook handler can call `emitExternal`
when something happens outside Matrix:

```ts
const fulfillment = new Ajent({
  name: "stripe-fulfillment",
  triggers: [{ kind: "external", source: "stripe", event: "payment.succeeded" }],
})

fulfillment.use(async (event) => {
  console.log("paid", event.payload)
})

bot.use(fulfillment)

await bot.emitExternal("stripe", "payment.succeeded", {
  checkoutSessionId: "cs_123",
})
```

Schedule triggers are available for repeated or one-time activation:

```ts
const dailyDigest = new Ajent({
  name: "daily-digest",
  triggers: [{ kind: "schedule", everyMs: 24 * 60 * 60 * 1000 }],
})
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

The example is [examples/ping-bot.ts](examples/ping-bot.ts).

## SubBot vs MicroBot

A `SubBot` is the feature boundary. It owns the top-level command.

```ts
const weather = new SubBot({
  name: "weather",
  command: ["!weather", "!w"],
})
```

If the feature has one natural action, put the handler directly on the `SubBot`:

```ts
weather.use(async (req: MatrixRequest, res: MatrixResponse) => {
  await res.replyText(`Weather for ${req.body}`)
})
```

This handles:

```text
!weather delhi
!w delhi
```

If the feature has multiple actions, add `MicroBot`s:

```ts
import { MicroBot, SubBot } from "../matrix-bot-sdk/js/src/index"

const weather = new SubBot({
  name: "weather",
  command: ["!weather", "!w"],
})

const current = new MicroBot({
  name: "current",
  command: ["current", "now"],
})

current.use(async (req: MatrixRequest, res: MatrixResponse) => {
  await res.replyText(`Current weather for ${req.body}`)
})

weather.use(current)
```

This handles:

```text
!weather current delhi
!w now delhi
```

Routing consumes commands as it goes:

| Input | Handler sees `req.body` |
| --- | --- |
| `!weather delhi` | `delhi` |
| `!weather current delhi` | `delhi` |
| `!w now delhi` | `delhi` |

If a `SubBot` has both microbots and its own handler, microbots win first. The `SubBot` handler becomes the fallback.

```ts
weather.use(current)

weather.use(async (req: MatrixRequest, res: MatrixResponse) => {
  await res.replyText(`Default weather lookup for ${req.body}`)
})
```

When `config.announceSubBotUsage` is enabled and the main bot recognizes a runnable subbot command, it immediately sends a room notice:

```text
> using weather...
```

Only the `SubBot` name is announced. Microbot names are not shown. The feature is opt-in so production bots do not add chat noise unless you ask for it.

## Self Documentation

The bot can document its own mounted family tree because `MatrixBot`, `SubBot`, and `MicroBot` already know their names, commands, descriptions, and mounted children.

When `config.selfDocumentation` is enabled, `listen()` writes:

```text
matrix-bot-family.md
```

The file includes the main bot, every mounted subbot, every mounted microbot, commands, descriptions, categories, and a text family tree.

```ts
const bot = new MatrixBot({
  homeserverUrl,
  username,
  password,
  recoveryKey,
  config: {
    selfDocumentation: true,
    documentationPath: "matrix-bot-family.md",
  },
})
```

The file write is opt-in so `listen()` does not create files unexpectedly. You can also generate or write the file manually:

```ts
const markdown = bot.generateSelfDocumentation()
await bot.writeSelfDocumentation("docs/bot-family.md")
```

## Middleware

Middleware wraps a handler. It receives `(req, res, next)`.

```ts
const ownerOnly = (owners: string[]) => {
  return async (
    req: MatrixRequest,
    res: MatrixResponse,
    next: () => Promise<void>,
  ) => {
    if (!owners.includes(req.sender)) {
      await res.replyText("Not allowed.")
      return
    }

    await next()
  }
}

ping.use(ownerOnly(["@you:matrix.org"]), async (
  _req: MatrixRequest,
  res: MatrixResponse,
) => {
  await res.replyText("pong")
})
```

Calling `next()` more than once throws.

## Replies

If a user sends a command while replying to another message, the replied-to event is available as `req.repliedMessage`.

```ts
const fact = new SubBot({
  name: "fact",
  command: ["!fact", "!check"],
})

fact.use(async (req: MatrixRequest, res: MatrixResponse) => {
  const claim = req.body.trim() || req.repliedMessage?.body

  if (!claim) {
    await res.replyText("Usage: !fact <claim>, or reply to a message with !fact")
    return
  }

  await res.sendText("Checking...")
  await res.replyMarkdown(await checkClaim(claim))
})
```

For example, `!ping` sent as a reply can inspect the original event:

```ts
ping.use(async (req: MatrixRequest, res: MatrixResponse) => {
  if (!req.repliedMessage) {
    await res.replyText("pong")
    return
  }

  await res.replyText(
    `pong for ${req.repliedMessage.sender}'s ${req.repliedMessage.messageType}`,
  )
})
```

The runtime extracts replied event metadata from Matrix text, notice, server notice, image, file, and video messages. For media replies, `req.repliedMessage.body` is the caption or filename, and `req.repliedMessage.media` carries file metadata.

If the user replied to unsupported content, `req.replyUnsupported` is `true`.

## Media And Polls

Incoming media is normalized onto `req.media`. For this to match a command, send the command as the media caption.

```ts
const images = new SubBot({
  name: "image-info",
  command: "!image",
})

images.use(async (req: MatrixRequest, res: MatrixResponse) => {
  if (req.messageType !== "image" || !req.media) {
    await res.replyText("Send an image with caption !image")
    return
  }

  const bytes = await res.downloadMedia()
  await res.replyText(`${req.media.filename}: ${bytes.length} bytes`)
})
```

If a command is sent as a reply to a media message, download that replied-to media by event id:

```ts
images.use(async (req: MatrixRequest, res: MatrixResponse) => {
  if (!req.repliedMessage?.media) {
    await res.replyText("Reply to an image or document with !image")
    return
  }

  const bytes = await res.downloadMedia({
    eventId: req.repliedMessage.eventId,
  })

  await res.replyText(`${req.repliedMessage.media.filename}: ${bytes.length} bytes`)
})
```

You can also download media from the bot client when you already have both ids:

```ts
const bytes = await bot.downloadMedia(roomId, eventId)
```

Send media:

```ts
await res.sendImage("./result.png")
await res.sendVideo("./clip.mp4")
await res.sendFile("./report.pdf")

await res.sendImage({
  filename: "result.png",
  contentType: "image/png",
  data: imageBuffer,
})

await res.sendMedia("file", {
  path: "./exports/result.csv",
  filename: "latest-result.csv",
})
```

String paths are read by the bot process, so relative paths are resolved from the process current working directory. Use the object form when you want to override the visible filename or content type.

Send a poll:

```ts
await res.sendPoll({
  question: "Ship it?",
  answers: [
    { id: "yes", text: "Yes" },
    { id: "no", text: "No" },
  ],
})
```

## Logging

Pass a logger when creating `MatrixBot`.

```ts
const bot = new MatrixBot({
  homeserverUrl,
  username,
  password,
  recoveryKey,
  logger(event) {
    process.stdout.write(`${JSON.stringify(event)}\n`)
  },
})
```

Log events are structured:

```ts
type MatrixLogEvent = {
  level: "debug" | "info" | "warn" | "error"
  message: string
  component: "sdk" | "runtime" | "dispatch"
  eventId?: string
  roomId?: string
  sender?: string
  handled?: number
  durationMs?: number
  error?: string
}
```

The default logger writes JSON for `info`, `warn`, and `error`. It drops `debug`.

Runtime logs from Rust are also sent through this logger.

## Global Error Handler

Use `onError` once instead of wrapping every handler in `try/catch`.

```ts
const bot = new MatrixBot({
  homeserverUrl,
  username,
  password,
  recoveryKey,
  async onError({ error, phase, request }) {
    await sendToOps({
      phase,
      eventId: request?.eventId,
      roomId: request?.roomId,
      error,
    })
  },
})
```

Handler errors are caught at the dispatch boundary and do not stop the sync loop.

## API Shape

### `MatrixBot`

```ts
const bot = new MatrixBot({
  homeserverUrl: "https://matrix.org",
  username: "@bot:matrix.org",
  password: "...",
  recoveryKey: "...",
  dataDir: ".matrix-bot-sdk",
  config: {
    announceSubBotUsage: true,
    selfDocumentation: true,
    documentationPath: "matrix-bot-family.md",
  },
  logger,
  onError,
})
```

| Option | Required | Meaning |
| --- | --- | --- |
| `homeserverUrl` | Yes | Matrix homeserver URL. |
| `username` | Yes | Bot Matrix user id or login username. |
| `password` | Yes | Bot account password. |
| `recoveryKey` | Yes | Matrix E2EE recovery key. |
| `dataDir` | No | Session, store, and cache directory. |
| `config.announceSubBotUsage` | No | Sends `> using <subbot>...` before running a matched subbot. Defaults to `false`. |
| `config.selfDocumentation` | No | Writes bot family Markdown when `listen()` starts. Defaults to `false`. |
| `config.documentationPath` | No | Markdown output path. Defaults to `matrix-bot-family.md`. |
| `logger` | No | Production log sink. |
| `onError` | No | Global runtime or dispatch error hook. |

```ts
bot.use(subBot)

await bot.listen({
  owners: ["@you:matrix.org"],
  timelineLimit: 20,
})
```

| Listen option | Required | Meaning |
| --- | --- | --- |
| `owners` | Yes | Users allowed to invite the bot into rooms. |
| `timelineLimit` | No | Per-room sync backlog cap. Defaults to `20`. |

### `SubBot`

```ts
const fact = new SubBot({
  name: "fact",
  command: ["!fact", "!check"],
  description: "Checks claims.",
  category: "Utility",
  adminOnly: false,
  config: {},
})
```

| Option | Required | Meaning |
| --- | --- | --- |
| `name` | Yes | Unique module name. |
| `command` | Yes | Main command or aliases. |
| `commands` | No | Extra aliases merged with `command`. |
| `description` | No | Help text metadata. |
| `category` | No | Grouping metadata. |
| `adminOnly` | No | Admin metadata flag. |
| `config` | No | Module-specific dependencies or settings. |

Sub-bot names and command aliases must be unique. In native mode, these aliases are registered with Rust so unrelated Matrix events can be ignored before Bun sees them.

### Request

```ts
type MatrixRequest = {
  eventId: string
  roomId: string
  sender: string
  messageType: "text" | "notice" | "server_notice" | "image" | "file" | "video" | "poll"
  rawBody: string
  body: string
  media?: MediaMessage
  poll?: PollMessage
  repliedMessage?: RepliedMessage
  replyUnsupported: boolean
}
```

```ts
type RepliedMessage = {
  eventId: string
  sender: string
  messageType: "text" | "notice" | "server_notice" | "image" | "file" | "video" | "poll"
  body: string
  media?: MediaMessage
}
```

`rawBody` is the original text. `body` is the remaining text after routing consumes the matched command tokens.

### Response

```ts
type MatrixResponse = {
  sendText(body: string): Promise<void>
  sendMarkdown(body: string): Promise<void>
  sendMedia(kind: "image" | "file" | "video", attachment: MediaAttachment): Promise<void>
  sendImage(attachment: MediaAttachment): Promise<void>
  sendFile(attachment: MediaAttachment): Promise<void>
  sendVideo(attachment: MediaAttachment): Promise<void>
  sendPoll(poll: OutboundPoll): Promise<void>
  replyText(body: string): Promise<void>
  replyMarkdown(body: string): Promise<void>
  downloadMedia(target?: string | { roomId?: string; eventId?: string }): Promise<Buffer>
}
```

`send*` posts to the room. `reply*` replies to the incoming event.
`downloadMedia()` returns the incoming event's bytes. Pass an event id, or `{ eventId }`, to download another media event from the same room. Pass `{ roomId, eventId }` to download from a specific room.

The bot client also exposes:

```ts
await bot.downloadMedia(roomId, eventId)
```

```ts
type MediaAttachment =
  | string
  | { path: string; filename?: string; contentType?: string }
  | { filename: string; contentType: string; data: Buffer | Uint8Array }
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

- `listen()` intentionally never resolves while the bot is running.
- The SDK sends Matrix notices, not normal user text messages.
- Markdown helpers render Matrix-formatted Markdown.
- Package publishing and platform binary distribution are not implemented yet.
