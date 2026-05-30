# Commands & Routing

If a feature has one natural action, use `bot.command`:

```ts
bot.command("!echo", async (ctx) => {
  await ctx.reply.text(ctx.message.body)
})
```

For sub-actions, use a group:

```ts
const weather = bot.group("!weather")

weather.command("current", async (ctx) => {
  await ctx.reply.text(`Current weather for ${ctx.message.body}`)
})

weather.command("forecast", async (ctx) => {
  await ctx.reply.text(`Weather forecast for ${ctx.message.body}`)
})
```
> **Note:** Routing consumes matched tokens. For `!weather current delhi`, `ctx.message.body` resolves to just `delhi` inside the handler. You can also pass an array of strings to register aliases (e.g. `bot.group(["!weather", "!w"])`).
