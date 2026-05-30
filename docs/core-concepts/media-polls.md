# Media & Polls

Incoming media properties are parsed onto `ctx.message.media`.

```ts
bot.command("!image", async (ctx) => {
  if (ctx.message.type !== "image" || !ctx.message.media) return
  const bytes = await ctx.downloadMedia()
  await ctx.reply.text(`Downloaded ${bytes.length} bytes`)
})
```

Send files or polls seamlessly via `ctx.send`:

```ts
const pollEventId = await ctx.send
  .message("Here is the latest report:")
  .file({ path: "./report.pdf" })
  .poll({
    question: "Ship it?",
    answers: [{ id: "yes", text: "Yes" }, { id: "no", text: "No" }],
  })
```

## Poll Options

You can customize poll behavior when creating one:

```ts
const pollEventId = await ctx.send.poll({
  question: "Favorite color?",
  answers: [
    { id: "r", text: "Red" },
    { id: "g", text: "Green" },
    { id: "b", text: "Blue" },
  ],
  // "undisclosed" hides votes until the poll ends.
  // "disclosed" (default) shows votes in real time.
  kind: "undisclosed",
  // Allow users to pick up to 2 answers (default: 1).
  maxSelections: 2,
})
```

## Listening for Poll Votes

Use `bot.on.pollVote` to react when someone votes.
By attaching an `actionId` to your poll when sending it, you can easily catch votes for *that specific poll type*, even if the bot is restarted!

```ts
// Send a tagged poll
await ctx.send.poll({
  actionId: "deploy_approval",
  question: "Deploy to production?",
  answers: [{ id: "y", text: "Yes" }, { id: "n", text: "No" }]
})

// Listen ONLY for votes on polls tagged with "deploy_approval"
bot.on.pollVote({ actionId: "deploy_approval" }, async (ctx) => {
  const { pollEventId, selections, actionId } = ctx.message.pollResponse!
  console.log(`Vote registered for ${actionId}!`)
})
```

## Listening for Poll End

Use `bot.on.pollEnd` to react when a poll is closed:

```ts
bot.on.pollEnd(async (ctx) => {
  const { pollEventId, text } = ctx.message.pollEnd!
  console.log(`Poll ${pollEventId} ended with text: ${text}`)
})
```

## Closing a Poll

End an active poll programmatically from any handler with `ctx.closePoll()`:

```ts
// Close a poll manually
await ctx.closePoll(pollEventId, "The poll has ended. Thanks for voting!")

// You can also use `bot.closePoll` outside of a handler context (e.g. timers)
setTimeout(() => {
  bot.closePoll(roomId, pollEventId, "Poll auto-closed after 24 hours.")
}, 24 * 60 * 60 * 1000)
```
