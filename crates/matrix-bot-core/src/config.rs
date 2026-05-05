use std::path::PathBuf;

use crate::{MatrixBotError, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatrixBotConfig {
    pub homeserver_url: String,
    pub username: String,
    pub password: String,
    pub recovery_key: String,
    pub data_dir: PathBuf,
}

impl MatrixBotConfig {
    pub fn new(
        homeserver_url: impl Into<String>,
        username: impl Into<String>,
        password: impl Into<String>,
        recovery_key: impl Into<String>,
    ) -> Result<Self> {
        let config = Self {
            homeserver_url: homeserver_url.into(),
            username: username.into(),
            password: password.into(),
            recovery_key: recovery_key.into(),
            data_dir: PathBuf::from(".matrix-bot-sdk"),
        };
        config.validate()?;
        Ok(config)
    }

    pub fn with_data_dir(mut self, data_dir: impl Into<PathBuf>) -> Result<Self> {
        self.data_dir = data_dir.into();
        self.validate()?;
        Ok(self)
    }

    pub fn validate(&self) -> Result<()> {
        required("homeserver_url", &self.homeserver_url)?;
        required("username", &self.username)?;
        required("password", &self.password)?;
        required("recovery_key", &self.recovery_key)?;
        Ok(())
    }
}

fn required(field: &'static str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        return Err(MatrixBotError::MissingField { field });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_required_fields() {
        let error = MatrixBotConfig::new("", "@bot:example.org", "secret", "recovery").unwrap_err();

        assert_eq!(
            error,
            MatrixBotError::MissingField {
                field: "homeserver_url"
            }
        );
    }

    #[test]
    fn defaults_data_dir() {
        let config = MatrixBotConfig::new(
            "https://matrix.example.org",
            "@bot:example.org",
            "secret",
            "recovery",
        )
        .unwrap();

        assert_eq!(config.data_dir, PathBuf::from(".matrix-bot-sdk"));
    }
}
