# Middleware

Wrap handlers to enforce access control, global rules, or logging. Middlewares are supported for both commands and listeners.

**Command Middleware:**
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
  await ctx.reply.text("Internal data.")
})
```

**Listener Middleware:**
```ts
const logEventMiddleware = async (event, actions, next) => {
  console.log(`Received event: ${event.kind}`)
  await next()
}

// Apply middleware to listeners
bot.on.message(logEventMiddleware, async (ctx) => {
  console.log("Processed message!")
})
```
