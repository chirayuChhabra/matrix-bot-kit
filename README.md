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

The Matrix Bot Kit provides a high-level TypeScript API for bot logic, backed by a Rust runtime that handles Matrix syncing, End-to-End Encryption (E2EE), state resolution, and connection pooling.

---

## Installation

Install using your preferred package manager:

```bash
npm install matrix-bot-kit
# or
bun add matrix-bot-kit
# or
yarn add matrix-bot-kit
```

---

## Features

- **Hybrid Architecture:** Rust handles syncing and crypto; TypeScript handles business logic.
- **Native E2EE:** Out-of-the-box support for end-to-end encryption and recovery keys.
- **Routing System:** Support for commands, nested command groups, and middleware.
- **Interactive Prompts:** Pause execution to wait for user input (`ctx.prompt`).
- **Session State:** Built-in memory store for multi-step conversations (`ctx.session`).
- **Event Listeners:** Schedule cron-like tasks, handle incoming webhooks, or process raw matrix events.
- **Rich Media & Polls:** Native helpers for sending/receiving images, files, videos, and interactive polls — with full control over poll settings (disclosed/undisclosed, max selections) and lifecycle (vote tracking, closing polls).
- **Reactions & Moderation:** APIs to react to messages or redact them.
- **Utility Commands:** Built-in maintainer toolkit (`!uptime`, `!status`, `!maintenance`, `!help`).

---

## Documentation

For full documentation and advanced usage, please refer to our detailed documentation folder:

- [Getting Started](./docs/getting-started.md)
- [Architecture](./docs/architecture.md)
- **Core Concepts**
  - [Commands & Routing](./docs/core-concepts/commands-routing.md)
  - [Listeners (Event-driven)](./docs/core-concepts/listeners.md)
  - [Middleware](./docs/core-concepts/middleware.md)
  - [Sessions & Prompts](./docs/core-concepts/sessions-prompts.md)
  - [Reactions & Redactions](./docs/core-concepts/reactions-redactions.md)
  - [Media & Polls](./docs/core-concepts/media-polls.md)
- **Advanced Features**
  - [Built-in Utility Commands](./docs/advanced/utility-commands.md)
  - [Self-Documentation](./docs/advanced/self-documentation.md)
- [API Reference](./docs/api-reference.md)
- [Logging & Error Handling](./docs/logging-error-handling.md)

