use crate::{HandlerBinding, MatrixBotError, MatrixContext, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ajent {
    name: String,
    triggers: Vec<AjentTrigger>,
}

impl Ajent {
    pub fn new(name: impl Into<String>) -> Result<Self> {
        let name = name.into();
        if name.trim().is_empty() {
            return Err(MatrixBotError::MissingField { field: "name" });
        }

        Ok(Self {
            name,
            triggers: Vec::new(),
        })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn triggers(&self) -> &[AjentTrigger] {
        &self.triggers
    }

    pub fn on_matrix_message(&mut self, trigger: AjentMatrixMessageTrigger) {
        self.triggers.push(AjentTrigger::MatrixMessage(trigger));
    }

    pub fn matches_matrix_message(&self, ctx: &MatrixContext) -> bool {
        self.triggers
            .iter()
            .any(|trigger| trigger.matches_matrix_message(ctx))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AjentTrigger {
    MatrixMessage(AjentMatrixMessageTrigger),
}

impl AjentTrigger {
    pub fn matches_matrix_message(&self, ctx: &MatrixContext) -> bool {
        match self {
            Self::MatrixMessage(trigger) => trigger.matches(ctx),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AjentMatrixMessageTrigger {
    message_types: Vec<String>,
    handler: HandlerBinding,
}

impl AjentMatrixMessageTrigger {
    pub fn new(handler: HandlerBinding) -> Self {
        Self {
            message_types: Vec::new(),
            handler,
        }
    }

    pub fn with_message_types(mut self, message_types: Vec<String>) -> Self {
        self.message_types = message_types
            .into_iter()
            .map(|message_type| message_type.trim().to_owned())
            .filter(|message_type| !message_type.is_empty())
            .collect();
        self
    }

    pub fn message_types(&self) -> &[String] {
        &self.message_types
    }

    pub fn handler(&self) -> &HandlerBinding {
        &self.handler
    }

    pub fn matches(&self, ctx: &MatrixContext) -> bool {
        self.message_types.is_empty()
            || self
                .message_types
                .iter()
                .any(|message_type| message_type == &ctx.message.message_type)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{IncomingMessage, MatrixContext};

    fn ctx(message_type: &str) -> MatrixContext {
        MatrixContext::new(
            IncomingMessage::new("$event", "!room:example.org", "@user:example.org", "hello")
                .with_message_type(message_type),
            "@bot:example.org",
        )
    }

    #[test]
    fn requires_name() {
        let error = Ajent::new(" ").unwrap_err();

        assert_eq!(error, MatrixBotError::MissingField { field: "name" });
    }

    #[test]
    fn matrix_message_trigger_matches_all_message_types_by_default() {
        let mut ajent = Ajent::new("watcher").unwrap();
        ajent.on_matrix_message(AjentMatrixMessageTrigger::new(HandlerBinding::new("js")));

        assert!(ajent.matches_matrix_message(&ctx("text")));
        assert!(ajent.matches_matrix_message(&ctx("image")));
    }

    #[test]
    fn matrix_message_trigger_can_filter_by_message_type() {
        let mut ajent = Ajent::new("image-indexer").unwrap();
        ajent.on_matrix_message(
            AjentMatrixMessageTrigger::new(HandlerBinding::new("js"))
                .with_message_types(vec!["image".to_owned()]),
        );

        assert!(ajent.matches_matrix_message(&ctx("image")));
        assert!(!ajent.matches_matrix_message(&ctx("text")));
    }
}
