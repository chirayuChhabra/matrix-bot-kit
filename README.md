# matrix-bot-sdk

Rust-first SDK for building Matrix bots with a backend-style routing model.

This repository is intentionally being built in small commits. The first module is the Rust core crate that owns stable SDK concepts:

- `MatrixBotConfig` for homeserver/login/recovery configuration.
- `MatrixBot` for the root bot instance.
- `SubBot` for named feature modules like `factcheck` and `imdb`.

The next layer will expose this core to Bun/TypeScript through a native binding.
