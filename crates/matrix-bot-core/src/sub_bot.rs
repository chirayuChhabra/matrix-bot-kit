use crate::{MatrixBotError, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubBot {
    name: String,
}

impl SubBot {
    pub fn new(name: impl Into<String>) -> Result<Self> {
        let name = name.into();
        if name.trim().is_empty() {
            return Err(MatrixBotError::MissingField { field: "name" });
        }

        Ok(Self { name })
    }

    pub fn name(&self) -> &str {
        &self.name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requires_name() {
        let error = SubBot::new(" ").unwrap_err();

        assert_eq!(error, MatrixBotError::MissingField { field: "name" });
    }
}
