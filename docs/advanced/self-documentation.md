# Self-Documentation

When `config.selfDocumentation` is enabled, the bot automatically generates a `matrix-bot-family.md` file charting its command structure on startup.

```ts
const bot = new MatrixBot({
  // ...
  config: {
    selfDocumentation: true,
    documentationPath: "docs/bot-family.md",
  },
})
```
