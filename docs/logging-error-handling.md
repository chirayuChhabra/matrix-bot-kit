# Logging & Error Handling

The SDK uses `loglevel` for internal logging (default level is `info`). You can provide a custom logger or rely on the default behavior.

```ts
import log from "loglevel";

const bot = new MatrixBot({
  // ...
  logger(event) {
    process.stdout.write(`${JSON.stringify(event)}\n`)
  },
  async onError({ error, phase, request }) {
    log.error(`Error in ${phase}:`, error)
  }
})
```

Handler errors are safely caught at the dispatch boundary, ensuring your bot's sync loop is never interrupted.
