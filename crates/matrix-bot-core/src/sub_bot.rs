use crate::{MatrixBotError, MatrixContext, Result, RouteLayer};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubBot {
    name: String,
    routes: Vec<RouteLayer>,
}

impl SubBot {
    pub fn new(name: impl Into<String>) -> Result<Self> {
        let name = name.into();
        if name.trim().is_empty() {
            return Err(MatrixBotError::MissingField { field: "name" });
        }

        Ok(Self {
            name,
            routes: Vec::new(),
        })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn routes(&self) -> &[RouteLayer] {
        &self.routes
    }

    pub fn use_route(&mut self, route: RouteLayer) {
        self.routes.push(route);
    }

    pub fn matching_routes<'a>(
        &'a self,
        ctx: &'a MatrixContext,
    ) -> impl Iterator<Item = &'a RouteLayer> {
        self.routes.iter().filter(|route| route.matches(ctx))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{HandlerBinding, IncomingMessage, MatrixContext, RouteMatcher};

    #[test]
    fn requires_name() {
        let error = SubBot::new(" ").unwrap_err();

        assert_eq!(error, MatrixBotError::MissingField { field: "name" });
    }

    #[test]
    fn keeps_routes_in_registration_order() {
        let mut sub_bot = SubBot::new("factcheck").unwrap();

        sub_bot.use_route(RouteLayer::new(
            RouteMatcher::prefix("!check"),
            HandlerBinding::new("factcheck"),
        ));
        sub_bot.use_route(RouteLayer::new(
            RouteMatcher::ReplyToBot,
            HandlerBinding::new("followup"),
        ));

        let ctx = MatrixContext::new(
            IncomingMessage::new(
                "$event",
                "!room:example.org",
                "@user:example.org",
                "!check x",
            ),
            "@bot:example.org",
        );
        let handlers = sub_bot
            .matching_routes(&ctx)
            .map(|route| route.handler.name())
            .collect::<Vec<_>>();

        assert_eq!(handlers, vec!["factcheck"]);
    }
}
