# API Reference

## `MatrixBotOptions`

| Option | Type | Default | Description |
| --- | --- | :---: | --- |
| `homeserverUrl` | `string` | **Required** | Matrix homeserver URL (e.g. `https://matrix.org`). |
| `username` | `string` | Optional | Bot Matrix username for password authentication. |
| `password` | `string` | Optional | Bot account password. |
| `auth` | `MatrixAuthOptions` | Optional | Structured credentials (`password` or `accessToken`). |
| `recoveryKey` | `string` | Optional | Matrix E2EE recovery key (optional for unencrypted / new bots). |
| `encryption` | `{ recoveryKey?: string } \| boolean` | Optional | E2EE configuration. |
| `admins` | `string[]` | `[]` | User IDs with administrative privileges. |
| `moderators` | `string[]` | `[]` | User IDs with moderator permissions. |
| `storage` | `{ directory?: string }` | `{ directory: "./.matrix-bot-kit" }` | Session and crypto state directory. |
| `timelineLimit` | `number` | `20` | Per-room sync backlog cap. |
| `config.announceCommandGroupUsage` | `boolean` | `false` | Announce group command usage. |
| `config.selfDocumentation` | `boolean` | `false` | Auto-document bot capabilities. |
| `config.utility` | `boolean \| UtilityConfig` | `false` | Enables built-in utility commands (`!ping`, `!status`, `!maintenance`, `!help`). |
| `logger` | `MatrixLogger` | `loglevel` | Custom log sink. |
| `onError` | `MatrixErrorHandler` | `undefined` | Global runtime or dispatch error hook. |

## `Context` Object

Every command and listener receives a strongly typed `Context`:

```ts
type Context<TSession = Record<string, any>> = {
  message: {
    id: string
    type: MatrixMessageType
    rawBody: string  // Original text (immutable)
    body: string     // Original text (immutable)
    media?: MessageMedia
    poll?: NativePollMessage
    pollResponse?: NativePollResponseMessage
    pollEnd?: NativePollEndMessage
    replyTo?: MessageHandle
    react: (emoji: string) => Promise<SentMessage>
    redact: (reason?: string) => Promise<void>
  }
  room: { id: string; isDirect: boolean }
  sender: {
    id: string
    userId: string
    mention: string
    isAdmin: () => boolean
    isModerator: () => boolean
  }
  args: string // Arguments after command prefix (e.g. "delhi" for "!weather delhi")
  command?: {
    name: string
    alias: string
    input: string
  }
  input?: unknown // Typed arguments if options.args parser was configured
  send: RoomSender // Room-bound actions returning SentMessage
  reply: RoomSender // Reply-bound actions returning SentMessage
  session: TSession // In-memory per-user-per-room state
  prompt: {
    text: (question: string, options?: PromptOptions) => Promise<PromptResult>
  }
  downloadMedia: (options?: { maxBytes?: number }) => Promise<Buffer>
  bot: MatrixBot
}
```

## `SentMessage` & `SentPoll`

Outbound sending returns rich, chainable `SentMessage` references:

```ts
interface SentMessage {
  id: string
  roomId: string
  react(emoji: string): Promise<SentMessage>
  redact(reason?: string): Promise<void>
  edit(newText: string): Promise<SentMessage>
  reply: RoomSender
}

interface SentPoll extends SentMessage {
  tag?: string
  close(summary?: string): Promise<void>
}
```

## `RoomHandle`

Send messages directly outside handlers (e.g. scheduled notifications or webhooks):

```ts
const room = bot.room("!general:matrix.org");
await room.send.text("Hello room!");
await room.send.markdown("**Bold notification**");
await room.send.poll({ question: "Ready?", answers: ["Yes", "No"] });
```
