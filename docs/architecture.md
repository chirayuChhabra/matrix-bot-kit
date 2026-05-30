# Architecture

The SDK is organized hierarchically. You instantiate a `MatrixBot`, attach `CommandGroup`s or `Listener`s, and mount `Command`s.

```mermaid
graph TD
    B[MatrixBot] --> G[CommandGroup e.g., !weather]
    G --> C1[Command: current]
    G --> C2[Command: forecast]
    B --> C3[Command: !echo]
    B --> L[Listener]
```

- **Commands** (`bot.command`, `bot.group`): Triggered by specific text prefixes.
- **Listeners** (`bot.on.*`): Triggered by Matrix events, timers, or webhooks.
