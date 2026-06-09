# Built-in Utility Commands

Set `config: { utility: { enabled: true, maintenancePassword: "your_password" } }` when initializing `MatrixBot` to enable built-in commands. 

## Public Commands
- `!help`: Generates a map of all available commands and groups.

## Admin-Only Commands (Direct Messages only)
- `!ping`: Responds with "pong".
- `!uptime`: Outputs the bot process uptime.
- `!version`: Outputs the bot version (from `package.json`).
- `!status`: Aggregates uptime, memory usage, and component counts.

## Password-Protected Commands
*(Prompts interactively for the `maintenancePassword` defined in your config)*
- `!maintenance`: Toggles maintenance mode. Intercepts non-admin commands.
- `!reload`: Spawns a new instance of the bot and gracefully shuts down the current one.
- `!shutdown`: Gracefully shuts down the process.
