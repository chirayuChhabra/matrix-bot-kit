# Getting Started

## Installation

Install `matrix-bot-kit` using your preferred package manager:

```bash
npm install matrix-bot-kit
# or
bun add matrix-bot-kit
# or
yarn add matrix-bot-kit
```

## Your First Bot (5 lines of code!)

Building a bot with `matrix-bot-kit` is now simpler than ever. No mandatory encryption keys or admin lists required to get started.

```ts
import { MatrixBot } from "matrix-bot-kit";

const bot = new MatrixBot({
  homeserverUrl: "https://matrix.org",
  username: process.env.BOT_USERNAME!,
  password: process.env.BOT_PASSWORD!,
});

// Simple echo command
bot.command("!echo", async (ctx) => {
  await ctx.reply.text(ctx.args);
});

await bot.start();
console.log("Bot is running!");
```

## Commands, Aliases & Groups

```ts
// Multiple aliases
bot.command(["!echo", "!say"], { description: "Repeat your message" }, async (ctx) => {
  await ctx.reply.text(ctx.args);
});

// Command Groups with Group Middleware and Default Fallback
const admin = bot.group("!admin", { access: "admin" });

admin.use(async (ctx, next) => {
  console.log(`[Admin audit] ${ctx.sender.id} accessed ${ctx.message.body}`);
  await next();
});

admin.command("status", async (ctx) => {
  await ctx.reply.text("All systems operational! 🚀");
});

admin.default(async (ctx) => {
  await ctx.reply.text("Unknown admin command. Available: !admin status");
});
```

## Interactive Prompts

Wait for user replies easily with non-blocking, typed prompt flows:

```ts
bot.command("!askname", async (ctx) => {
  const result = await ctx.prompt.text("What is your name?");
  if (result.status === "answered") {
    await ctx.reply.text(`Hello, ${result.text}!`);
  }
});
```

## Background Schedules & Room Sends

```ts
// Send scheduled notifications directly to rooms
bot.schedule("daily-report", { every: { hours: 24 } }, async (job) => {
  await bot.room("!general:matrix.org").send.text("Daily reminder!");
});
```
