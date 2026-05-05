use crate::{HandlerBinding, MatrixContext, RouteLayer, SubBot};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DispatchPlan {
    routes: Vec<DispatchRoute>,
}

impl DispatchPlan {
    pub fn new(routes: Vec<DispatchRoute>) -> Self {
        Self { routes }
    }

    pub fn routes(&self) -> &[DispatchRoute] {
        &self.routes
    }

    pub fn is_empty(&self) -> bool {
        self.routes.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DispatchRoute {
    pub sub_bot_name: String,
    pub steps: Vec<DispatchStep>,
}

impl DispatchRoute {
    pub fn from_route(sub_bot: &SubBot, route: &RouteLayer) -> Self {
        let mut steps = route
            .middleware
            .iter()
            .cloned()
            .map(DispatchStep::Middleware)
            .collect::<Vec<_>>();
        steps.push(DispatchStep::Handler(route.handler.clone()));

        Self {
            sub_bot_name: sub_bot.name().to_owned(),
            steps,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DispatchStep {
    Middleware(HandlerBinding),
    Handler(HandlerBinding),
}

pub fn build_dispatch_plan<'a>(
    sub_bots: impl IntoIterator<Item = &'a SubBot>,
    ctx: &MatrixContext,
) -> DispatchPlan {
    let routes = sub_bots
        .into_iter()
        .flat_map(|sub_bot| {
            sub_bot
                .matching_routes(ctx)
                .map(|route| DispatchRoute::from_route(sub_bot, route))
        })
        .collect();

    DispatchPlan::new(routes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{IncomingMessage, MatrixContext, RouteMatcher};

    #[test]
    fn builds_steps_with_middleware_before_handler() {
        let mut sub_bot = SubBot::new("factcheck").unwrap();
        sub_bot.use_route(
            RouteLayer::new(
                RouteMatcher::prefix("!check"),
                HandlerBinding::new("factcheck_handler"),
            )
            .with_middleware(vec![
                HandlerBinding::new("owner_only"),
                HandlerBinding::new("typing_notice"),
            ]),
        );

        let ctx = MatrixContext::new(
            IncomingMessage::new(
                "$event",
                "!room:example.org",
                "@user:example.org",
                "!check x",
            ),
            "@bot:example.org",
        );
        let plan = build_dispatch_plan([&sub_bot], &ctx);

        assert_eq!(
            plan.routes(),
            &[DispatchRoute {
                sub_bot_name: "factcheck".to_owned(),
                steps: vec![
                    DispatchStep::Middleware(HandlerBinding::new("owner_only")),
                    DispatchStep::Middleware(HandlerBinding::new("typing_notice")),
                    DispatchStep::Handler(HandlerBinding::new("factcheck_handler")),
                ],
            }]
        );
    }
}
