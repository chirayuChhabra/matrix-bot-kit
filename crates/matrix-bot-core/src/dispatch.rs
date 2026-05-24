use crate::{Ajent, HandlerBinding, MatrixContext, RouteLayer, SubBot};

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AjentDispatchPlan {
    ajents: Vec<AjentDispatchRoute>,
}

impl AjentDispatchPlan {
    pub fn new(ajents: Vec<AjentDispatchRoute>) -> Self {
        Self { ajents }
    }

    pub fn ajents(&self) -> &[AjentDispatchRoute] {
        &self.ajents
    }

    pub fn is_empty(&self) -> bool {
        self.ajents.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AjentDispatchRoute {
    pub ajent_name: String,
    pub handler: HandlerBinding,
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

pub fn build_ajent_dispatch_plan<'a>(
    ajents: impl IntoIterator<Item = &'a Ajent>,
    ctx: &MatrixContext,
) -> AjentDispatchPlan {
    let routes = ajents
        .into_iter()
        .flat_map(|ajent| {
            ajent
                .triggers()
                .iter()
                .filter(|trigger| trigger.matches_matrix_message(ctx))
                .map(|trigger| {
                    let handler = match trigger {
                        crate::AjentTrigger::MatrixMessage(trigger) => trigger.handler().clone(),
                    };
                    AjentDispatchRoute {
                        ajent_name: ajent.name().to_owned(),
                        handler,
                    }
                })
        })
        .collect();

    AjentDispatchPlan::new(routes)
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

    #[test]
    fn builds_ajent_dispatch_plan_for_matching_matrix_message_triggers() {
        let mut all_messages = Ajent::new("all-messages").unwrap();
        let mut images = Ajent::new("images").unwrap();
        all_messages
            .on_matrix_message(crate::AjentMatrixMessageTrigger::new(HandlerBinding::new("js")));
        images.on_matrix_message(
            crate::AjentMatrixMessageTrigger::new(HandlerBinding::new("js"))
                .with_message_types(vec!["image".to_owned()]),
        );

        let ctx = MatrixContext::new(
            IncomingMessage::new(
                "$event",
                "!room:example.org",
                "@user:example.org",
                "hello",
            ),
            "@bot:example.org",
        );
        let plan = build_ajent_dispatch_plan([&all_messages, &images], &ctx);

        assert_eq!(
            plan.ajents(),
            &[AjentDispatchRoute {
                ajent_name: "all-messages".to_owned(),
                handler: HandlerBinding::new("js"),
            }]
        );
    }
}
