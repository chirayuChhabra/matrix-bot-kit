<div align="center">
  <h1>Matrix Bot Kit</h1>
  <p><b>A TypeScript framework for building Matrix bots with a native Rust backend.</b></p>
  <p>
    <a href="https://matrix.org"><img src="https://img.shields.io/badge/Matrix-Compatible-black?style=flat-square&logo=matrix" alt="Matrix Compatible" /></a>
    <a href="https://bun.sh/"><img src="https://img.shields.io/badge/Bun-%23000000.svg?style=flat-square&logo=bun&logoColor=white" alt="Bun"></a>
    <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-Backend-orange?style=flat-square&logo=rust" alt="Rust Backend"></a>
  </p>
</div>

---

The Matrix Bot Kit provides a clean, modern, developer-friendly TypeScript API for bot logic, backed by a high-performance native Rust runtime.

---

## Installation

```bash
npm install matrix-bot-kit
# or
bun add matrix-bot-kit
# or
yarn add matrix-bot-kit
```

---

## Quick Start

```ts
import { MatrixBot } from "matrix-bot-kit";

const bot = new MatrixBot({
  homeserverUrl: "https://matrix.org",
  username: process.env.BOT_USERNAME!,
  password: process.env.BOT_PASSWORD!,
});

// Simple command
bot.command("!echo", async (ctx) => {
  await ctx.reply.text(ctx.args);
});

// Group commands with middleware and default handler
const weather = bot.group("!weather", { description: "Weather info" });
weather.command("today", async (ctx) => {
  await ctx.reply.text(`Weather for ${ctx.args || "your city"}: ☀️ 22°C`);
});
weather.default(async (ctx) => {
  await ctx.reply.text("Usage: !weather today <city>");
});

// Interactive prompt
bot.command("!ask", async (ctx) => {
  const answer = await ctx.prompt.text("What is your favorite color?");
  if (answer.status === "answered") {
    await ctx.reply.text(`Nice! ${answer.text} is a great color.`);
  }
});

// Background schedule
bot.schedule("daily-sync", { every: { hours: 24 } }, async () => {
  await bot.room("!general:matrix.org").send.text("Daily check-in!");
});

await bot.start();
console.log("Bot running!");
```

---

## Features

- **Developer Experience (DX) First:** Zero mandatory boilerplate. Start a bot in 5 lines of code.
- **Hybrid Architecture:** Rust handles syncing and crypto; TypeScript handles business logic.
- **Native E2EE:** Out-of-the-box support for end-to-end encryption.
- **Clean Routing:** Support for commands, nested command groups, middleware, and fallbacks.
- **Interactive Prompts:** Race-free prompt flow with typed outcomes (`ctx.prompt.text`).
- **Session State:** Built-in store for multi-step conversations (`ctx.session`).
- **Direct Room Sends:** Send text, markdown, polls, and media directly from anywhere (`bot.room(id).send.text`).
- **Rich Media & Polls:** Native helpers for media attachments and polls with `.close()`.
- **Reactions & Moderation:** APIs to react to messages or redact them directly on `SentMessage`.
- **Isolated Background Jobs:** Named interval and one-shot schedules with overlap control.

---

## Documentation

- [Getting Started](./docs/getting-started.md)
- [Architecture](./docs/architecture.md)
- [API Reference](./docs/api-reference.md)
- **Core Concepts**
  - [Commands & Routing](./docs/core-concepts/commands-routing.md)
  - [Listeners (Event-driven)](./docs/core-concepts/listeners.md)
  - [Middleware](./docs/core-concepts/middleware.md)
  - [Sessions & Prompts](./docs/core-concepts/sessions-prompts.md)
  - [Reactions & Redactions](./docs/core-concepts/reactions-redactions.md)
  - [Media & Polls](./docs/core-concepts/media-polls.md)
