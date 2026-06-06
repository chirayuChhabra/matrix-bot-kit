# Sessions & Prompts

The SDK provides tools for multi-step conversations.

**Interactive Prompts:**
You can pause execution to wait for the user's next message.

```ts
bot.command("!register", async (ctx) => {
  const response = await ctx.prompt("What is your email address?")
  await ctx.reply.text(`Registered email: ${response.message.body}`)
})
```

**Session State:**
Persist data across multiple interactions. *Note: Session data is stored in memory per-user, per-room, and automatically expires after 24 hours of inactivity to prevent memory leaks.*

```ts
bot.command("!counter", async (ctx) => {
  ctx.session.count = (ctx.session.count || 0) + 1
  await ctx.reply.text(`You have called this ${ctx.session.count} times.`)
})
```
