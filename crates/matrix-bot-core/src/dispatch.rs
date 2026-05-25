use crate::{Listener, HandlerBinding, MatrixContext, RouteLayer, CommandGroup};

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
    pub command_group_name: String,
    pub steps: Vec<DispatchStep>,
}

impl DispatchRoute {
    pub fn from_route(command_group: &CommandGroup, route: &RouteLayer) -> Self {
        let mut steps = route
            .middleware
            .iter()
            .cloned()
            .map(DispatchStep::Middleware)
            .collect::<Vec<_>>();
        steps.push(DispatchStep::Handler(route.handler.clone()));

        Self {
            command_group_name: command_group.name().to_owned(),
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
pub struct ListenerDispatchPlan {
    listeners: Vec<ListenerDispatchRoute>,
}

impl ListenerDispatchPlan {
    pub fn new(listeners: Vec<ListenerDispatchRoute>) -> Self {
        Self { listeners }
    }

    pub fn listeners(&self) -> &[ListenerDispatchRoute] {
        &self.listeners
    }

    pub fn is_empty(&self) -> bool {
        self.listeners.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListenerDispatchRoute {
    pub listener_name: String,
    pub handler: HandlerBinding,
}

pub fn build_dispatch_plan<'a>(
    command_groups: impl IntoIterator<Item = &'a CommandGroup>,
    ctx: &MatrixContext,
) -> DispatchPlan {
    let routes = command_groups
        .into_iter()
        .flat_map(|command_group| {
            command_group
                .matching_routes(ctx)
                .map(|route| DispatchRoute::from_route(command_group, route))
        })
        .collect();

    DispatchPlan::new(routes)
}

pub fn build_listener_dispatch_plan<'a>(
    listeners: impl IntoIterator<Item = &'a Listener>,
    ctx: &MatrixContext,
) -> ListenerDispatchPlan {
    let routes = listeners
        .into_iter()
        .flat_map(|listener| {
            listener
                .triggers()
                .iter()
                .filter(|trigger| trigger.matches_matrix_message(ctx))
                .map(|trigger| {
                    let handler = match trigger {
                        crate::ListenerTrigger::MatrixMessage(trigger) => trigger.handler().clone(),
                    };
                    ListenerDispatchRoute {
                        listener_name: listener.name().to_owned(),
                        handler,
                    }
                })
        })
        .collect();

    ListenerDispatchPlan::new(routes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{IncomingMessage, MatrixContext, RouteMatcher};

    #[test]
    fn builds_steps_with_middleware_before_handler() {
        let mut command_group = CommandGroup::new("factcheck").unwrap();
        command_group.use_route(
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
        let plan = build_dispatch_plan([&command_group], &ctx);

        assert_eq!(
            plan.routes(),
            &[DispatchRoute {
                command_group_name: "factcheck".to_owned(),
                steps: vec![
                    DispatchStep::Middleware(HandlerBinding::new("owner_only")),
                    DispatchStep::Middleware(HandlerBinding::new("typing_notice")),
                    DispatchStep::Handler(HandlerBinding::new("factcheck_handler")),
                ],
            }]
        );
    }

    #[test]
    fn builds_listener_dispatch_plan_for_matching_matrix_message_triggers() {
        let mut all_messages = Listener::new("all-messages").unwrap();
        let mut images = Listener::new("images").unwrap();
        all_messages
            .on_matrix_message(crate::ListenerMatrixMessageTrigger::new(HandlerBinding::new("js")));
        images.on_matrix_message(
            crate::ListenerMatrixMessageTrigger::new(HandlerBinding::new("js"))
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
        let plan = build_listener_dispatch_plan([&all_messages, &images], &ctx);

        assert_eq!(
            plan.listeners(),
            &[ListenerDispatchRoute {
                listener_name: "all-messages".to_owned(),
                handler: HandlerBinding::new("js"),
            }]
        );
    }
}
