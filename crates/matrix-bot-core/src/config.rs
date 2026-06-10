use std::path::PathBuf;

use crate::{MatrixBotError, Result};

#[derive(Clone, PartialEq, Eq)]
pub struct SecretString(String);

impl std::fmt::Debug for SecretString {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Secret([REDACTED])")
    }
}

impl std::ops::Deref for SecretString {
    type Target = str;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatrixBotConfig {
    pub homeserver_url: String,
    pub username: String,
    pub password: SecretString,
    pub recovery_key: SecretString,
    pub data_dir: PathBuf,
    pub admin: Vec<String>,
    pub moderator: Vec<String>,
    pub timeline_limit: u32,
}

impl MatrixBotConfig {
    pub fn new(
        homeserver_url: impl Into<String>,
        username: impl Into<String>,
        password: impl Into<String>,
        recovery_key: impl Into<String>,
        admin: Vec<String>,
        moderator: Vec<String>,
        timeline_limit: u32,
    ) -> Result<Self> {
        let config = Self {
            homeserver_url: homeserver_url.into(),
            username: username.into(),
            password: SecretString(password.into()),
            recovery_key: SecretString(recovery_key.into()),
            data_dir: PathBuf::from(".matrix-bot-kit"),
            admin,
            moderator,
            timeline_limit,
        };
        config.validate()?;
        Ok(config)
    }

    pub fn is_admin(&self, user_id: &str) -> bool {
        self.admin.iter().any(|a| a == user_id)
    }

    pub fn is_moderator(&self, user_id: &str) -> bool {
        self.is_admin(user_id) || self.moderator.iter().any(|m| m == user_id)
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
        let error = MatrixBotConfig::new("", "@bot:example.org", "secret", "recovery", vec![], vec![], 20).unwrap_err();

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
            vec![],
            vec![],
            20,
        )
        .unwrap();

        assert_eq!(config.data_dir, PathBuf::from(".matrix-bot-kit"));
    }
}
