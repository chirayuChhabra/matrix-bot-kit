#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IncomingMessage {
    pub event_id: String,
    pub room_id: String,
    pub sender: String,
    pub body: String,
    pub reply_target: ReplyTarget,
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
            reply_target: ReplyTarget::NoReply,
        }
    }

    pub fn with_replied_message(mut self, replied_message: RepliedMessage) -> Self {
        self.reply_target = ReplyTarget::Text(replied_message);
        self
    }

    pub fn with_unsupported_reply(mut self, event_id: impl Into<String>) -> Self {
        self.reply_target = ReplyTarget::Unsupported {
            event_id: event_id.into(),
        };
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepliedMessage {
    pub event_id: String,
    pub sender: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReplyTarget {
    Text(RepliedMessage),
    Unsupported { event_id: String },
    NoReply,
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
        matches!(
            &self.message.reply_target,
            ReplyTarget::Text(message) if message.sender == self.bot_user_id
        )
    }

    pub fn replied_message(&self) -> Option<&RepliedMessage> {
        match &self.message.reply_target {
            ReplyTarget::Text(message) => Some(message),
            ReplyTarget::Unsupported { .. } | ReplyTarget::NoReply => None,
        }
    }
}
