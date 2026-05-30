# Built-in Utility Commands

Set `config: { utility: true }` when initializing `MatrixBot` to enable built-in commands. 

## Public Commands
- `!help`: Generates a map of all available commands and groups.

## Admin-Only Commands (Direct Messages only)
- `!ping`: Responds with "pong".
- `!uptime`: Outputs the bot process uptime.
- `!version`: Outputs the bot version (from `package.json`).
- `!status`: Aggregates uptime, memory usage, and component counts.

## Password-Protected Commands
*(Requires `MAINTENANCE_PASSWORD` in your environment)*
- `!maintenance <password>`: Toggles maintenance mode. Intercepts non-admin commands.
- `!reload <password>`: Rebuilds and restarts the process using `scripts/reload.sh`.
- `!shutdown <password>`: Gracefully shuts down the process.
