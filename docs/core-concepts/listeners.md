# Listeners (Event-driven)

Use the `bot.on` namespace to listen for any Matrix event or background schedule.

```ts
// Respond to all images
bot.on.image(async (ctx) => {
  await ctx.reply.text("That's a nice image!")
})

// Listen only in specific rooms
bot.on.message({ rooms: ["!myRoomId:example.com"] }, async (ctx) => {
  console.log("Secret room message:", ctx.message.body)
})

// Background schedules
bot.on.schedule({ everyMs: 1000 * 60 * 60 }, async (ctx) => {
  await ctx.send.text("!myRoomId:example.com", "Hourly ping!")
})

// Webhooks
bot.on.webhook({ source: "github", event: "push" }, async (ctx) => {
  console.log("Github push received!")
})
```
