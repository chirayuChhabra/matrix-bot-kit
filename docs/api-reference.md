# API Reference

## `MatrixBotOptions`

| Option | Required | Description |
| --- | :---: | --- |
| `homeserverUrl` | ✅ | Matrix homeserver URL (e.g. `https://matrix.org`). |
| `username` | ✅ | Bot Matrix user id or login username. |
| `password` | ✅ | Bot account password. |
| `recoveryKey` | ✅ | Matrix E2EE recovery key. |
| `admin` | ✅ | Users allowed to invite the bot and use admin-only commands. |
| `moderator` | ❌ | Users with moderator permissions. |
| `timelineLimit` | ❌ | Per-room sync backlog cap. Defaults to `20`. |
| `dataDir` | ❌ | Session, store, and cache directory. Defaults to `.matrix-bot-kit`. |
| `config.announceCommandGroupUsage` | ❌ | Sends `> using <group>...` before running a matched group. |
| `config.selfDocumentation` | ❌ | Writes bot family Markdown when `start()` runs. |
| `config.utility` | ❌ | Activates built-in maintainer/utility commands. |
| `logger` | ❌ | Custom log sink. |
| `onError` | ❌ | Global runtime or dispatch error hook. |

## `Context` Object

The `Context` object encapsulates the event and utility functions:

```ts
type Context = {
  message: {
    id: string
    type: "text" | "notice" | "server_notice" | "image" | "file" | "video" | "poll" | "poll_response" | "poll_end"
    rawBody: string  // Original text
    body: string     // Text after route consumption
    media?: MediaMessage
    poll?: PollMessage
    pollResponse?: PollResponseMessage  // Present when type is "poll_response"
    pollEnd?: PollEndMessage            // Present when type is "poll_end"
    reply?: { target?: RepliedMessage; isUnsupported: boolean }
    react: (emoji: string) => Promise<void>
    redact: (reason?: string) => Promise<void>
  }
  room: { id: string; isDirect: boolean }
  sender: {
    id: string
    mention: string
    isAdmin(userId?: string): boolean
    isModerator(userId?: string): boolean
  }
  send: SendContext // Chainable sender (.message, .markdown, .file, .poll, etc.)
  reply: ReplyContext // Chainable replier (.text, .markdown)
  session: Record<string, any> // In-memory per-user-per-room state
  prompt: (body: string, options?: { timeoutMs?: number }) => Promise<Context>
  downloadMedia(target?: string | { roomId?: string; eventId?: string }): Promise<Buffer>
}
```

## Poll Types

```ts
type OutboundPoll = {
  question: string
  answers: { id: string; text: string }[]
  kind?: "disclosed" | "undisclosed"  // default: "disclosed"
  maxSelections?: number              // default: 1
}

type PollResponseMessage = {
  pollEventId: string     // The event ID of the poll
  selections: string[]    // The answer IDs the user selected
}

type PollEndMessage = {
  pollEventId: string     // The event ID of the poll
  text: string            // Fallback text
}
```
