#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IncomingMessage {
    pub event_id: String,
    pub room_id: String,
    pub sender: String,
    pub body: String,
    pub replied_message: Option<RepliedMessage>,
}

impl IncomingMessage {
    pub fn new(
        event_id: impl Into<String>,
        room_id: impl Into<String>,
        sender: impl Into<String>,
        body: impl Into<String>,
    ) -> Self {
        Self {
            event_id: event_id.into(),
            room_id: room_id.into(),
            sender: sender.into(),
            body: body.into(),
            replied_message: None,
        }
    }

    pub fn with_replied_message(mut self, replied_message: RepliedMessage) -> Self {
        self.replied_message = Some(replied_message);
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepliedMessage {
    pub event_id: String,
    pub sender: String,
    pub body: String,
}

impl RepliedMessage {
    pub fn new(
        event_id: impl Into<String>,
        sender: impl Into<String>,
        body: impl Into<String>,
    ) -> Self {
        Self {
            event_id: event_id.into(),
            sender: sender.into(),
            body: body.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatrixContext {
    pub message: IncomingMessage,
    pub bot_user_id: String,
}

impl MatrixContext {
    pub fn new(message: IncomingMessage, bot_user_id: impl Into<String>) -> Self {
        Self {
            message,
            bot_user_id: bot_user_id.into(),
        }
    }

    pub fn body(&self) -> &str {
        self.message.body.trim()
    }

    pub fn is_reply_to_bot(&self) -> bool {
        self.message
            .replied_message
            .as_ref()
            .is_some_and(|message| message.sender == self.bot_user_id)
    }
}
