# Reactions & Redactions

Interact with messages programmatically.

```ts
bot.command("!approve", async (ctx) => {
  // React to the message
  await ctx.message.react("✅")
  
  if (ctx.message.reply?.target) {
    // Redact the message that the user replied to
    // Note: requires moderation permissions in the room
    await ctx.message.redact("Approved and removed.")
  }
})
```
