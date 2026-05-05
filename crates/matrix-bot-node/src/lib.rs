use std::path::PathBuf;

use matrix_bot_core::{MatrixBotConfig, SubBot as CoreSubBot};
use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct MatrixBotOptions {
    pub homeserver_url: String,
    pub username: String,
    pub password: String,
    pub recovery_key: String,
    pub data_dir: Option<String>,
}

#[napi]
pub struct MatrixBot {
    inner: matrix_bot_core::MatrixBot,
}

#[napi]
impl MatrixBot {
    #[napi(constructor)]
    pub fn new(options: MatrixBotOptions) -> Result<Self> {
        let mut config = MatrixBotConfig::new(
            options.homeserver_url,
            options.username,
            options.password,
            options.recovery_key,
        )
        .map_err(to_napi_error)?;

        if let Some(data_dir) = options.data_dir {
            config = config
                .with_data_dir(PathBuf::from(data_dir))
                .map_err(to_napi_error)?;
        }

        Ok(Self {
            inner: matrix_bot_core::MatrixBot::new(config).map_err(to_napi_error)?,
        })
    }

    #[napi]
    pub fn register_sub_bot(&mut self, sub_bot: &SubBot) -> Result<()> {
        self.inner
            .use_sub_bot(sub_bot.inner.clone())
            .map_err(to_napi_error)
    }

    #[napi(getter)]
    pub fn sub_bot_count(&self) -> u32 {
        self.inner.sub_bots().len() as u32
    }
}

#[napi]
pub struct SubBot {
    inner: CoreSubBot,
}

#[napi]
impl SubBot {
    #[napi(constructor)]
    pub fn new(name: String) -> Result<Self> {
        Ok(Self {
            inner: CoreSubBot::new(name).map_err(to_napi_error)?,
        })
    }

    #[napi(getter)]
    pub fn name(&self) -> String {
        self.inner.name().to_owned()
    }
}

fn to_napi_error(error: impl std::fmt::Display) -> Error {
    Error::from_reason(error.to_string())
}
