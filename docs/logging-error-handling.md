# Logging & Error Handling

Provide a custom logger or rely on the default structured JSON logger.

```ts
const bot = new MatrixBot({
  // ...
  logger(event) {
    process.stdout.write(`${JSON.stringify(event)}\n`)
  },
  async onError({ error, phase, request }) {
    console.error(`Error in ${phase}:`, error)
  }
})
```

Handler errors are safely caught at the dispatch boundary, ensuring your bot's sync loop is never interrupted.
