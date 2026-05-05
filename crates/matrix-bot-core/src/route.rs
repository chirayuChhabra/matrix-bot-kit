use crate::MatrixContext;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RouteMatcher {
    AnyText,
    Exact(String),
    Prefix(String),
    ReplyToBot,
}

impl RouteMatcher {
    pub fn exact(value: impl Into<String>) -> Self {
        Self::Exact(value.into())
    }

    pub fn prefix(value: impl Into<String>) -> Self {
        Self::Prefix(value.into())
    }

    pub fn matches(&self, ctx: &MatrixContext) -> bool {
        match self {
            Self::AnyText => !ctx.body().is_empty(),
            Self::Exact(value) => ctx.body() == value,
            Self::Prefix(value) => ctx.body().starts_with(value),
            Self::ReplyToBot => ctx.is_reply_to_bot(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteLayer {
    pub matcher: RouteMatcher,
    pub middleware: Vec<HandlerBinding>,
    pub handler: HandlerBinding,
}

impl RouteLayer {
    pub fn new(matcher: RouteMatcher, handler: HandlerBinding) -> Self {
        Self {
            matcher,
            middleware: Vec::new(),
            handler,
        }
    }

    pub fn with_middleware(mut self, middleware: Vec<HandlerBinding>) -> Self {
        self.middleware = middleware;
        self
    }

    pub fn matches(&self, ctx: &MatrixContext) -> bool {
        self.matcher.matches(ctx)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HandlerBinding {
    name: String,
}

impl HandlerBinding {
    pub fn new(name: impl Into<String>) -> Self {
        Self { name: name.into() }
    }

    pub fn name(&self) -> &str {
        &self.name
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{IncomingMessage, MatrixContext, RepliedMessage};

    fn ctx(body: &str) -> MatrixContext {
        MatrixContext::new(
            IncomingMessage::new("$event", "!room:example.org", "@user:example.org", body),
            "@bot:example.org",
        )
    }

    #[test]
    fn prefix_routes_match_command_text() {
        assert!(RouteMatcher::prefix("!check").matches(&ctx("!check moon is cheese")));
        assert!(!RouteMatcher::prefix("!imdb").matches(&ctx("!check moon is cheese")));
    }

    #[test]
    fn reply_to_bot_matches_replied_bot_message() {
        let ctx = MatrixContext::new(
            IncomingMessage::new("$event", "!room:example.org", "@user:example.org", "why?")
                .with_replied_message(RepliedMessage::new(
                    "$reply",
                    "@bot:example.org",
                    "previous answer",
                )),
            "@bot:example.org",
        );

        assert!(RouteMatcher::ReplyToBot.matches(&ctx));
    }
}
