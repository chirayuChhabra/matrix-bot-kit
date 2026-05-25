use std::collections::HashSet;

use crate::{
    Listener, ListenerDispatchPlan, DispatchPlan, MatrixBotConfig, MatrixBotError, MatrixContext, Result,
    CommandGroup,
};

#[derive(Debug)]
pub struct MatrixBot {
    config: MatrixBotConfig,
    command_groups: Vec<CommandGroup>,
    command_group_names: HashSet<String>,
    listeners: Vec<Listener>,
    listener_names: HashSet<String>,
}

impl MatrixBot {
    pub fn new(config: MatrixBotConfig) -> Result<Self> {
        config.validate()?;
        Ok(Self {
            config,
            command_groups: Vec::new(),
            command_group_names: HashSet::new(),
            listeners: Vec::new(),
            listener_names: HashSet::new(),
        })
    }

    pub fn config(&self) -> &MatrixBotConfig {
        &self.config
    }

    pub fn command_groups(&self) -> &[CommandGroup] {
        &self.command_groups
    }

    pub fn listeners(&self) -> &[Listener] {
        &self.listeners
    }

    pub fn use_command_group(&mut self, command_group: CommandGroup) -> Result<()> {
        if !self.command_group_names.insert(command_group.name().to_owned()) {
            return Err(MatrixBotError::DuplicateCommandGroup {
                name: command_group.name().to_owned(),
            });
        }

        self.command_groups.push(command_group);
        Ok(())
    }

    pub fn use_listener(&mut self, listener: Listener) -> Result<()> {
        if !self.listener_names.insert(listener.name().to_owned()) {
            return Err(MatrixBotError::DuplicateListener {
                name: listener.name().to_owned(),
            });
        }

        self.listeners.push(listener);
        Ok(())
    }

    pub fn dispatch_plan(&self, ctx: &MatrixContext) -> DispatchPlan {
        crate::dispatch::build_dispatch_plan(&self.command_groups, ctx)
    }

    pub fn listener_dispatch_plan(&self, ctx: &MatrixContext) -> ListenerDispatchPlan {
        crate::dispatch::build_listener_dispatch_plan(&self.listeners, ctx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        ListenerMatrixMessageTrigger, DispatchStep, HandlerBinding, IncomingMessage, RouteLayer,
        RouteMatcher,
    };

    fn config() -> MatrixBotConfig {
        MatrixBotConfig::new(
            "https://matrix.example.org",
            "@bot:example.org",
            "secret",
            "recovery",
            vec![],
            vec![],
            20,
        )
        .unwrap()
    }

    #[test]
    fn registers_command_groups_in_order() {
        let mut bot = MatrixBot::new(config()).unwrap();

        bot.use_command_group(CommandGroup::new("factcheck").unwrap()).unwrap();
        bot.use_command_group(CommandGroup::new("imdb").unwrap()).unwrap();

        let names = bot.command_groups().iter().map(CommandGroup::name).collect::<Vec<_>>();
        assert_eq!(names, vec!["factcheck", "imdb"]);
    }

    #[test]
    fn rejects_duplicate_command_group_names() {
        let mut bot = MatrixBot::new(config()).unwrap();

        bot.use_command_group(CommandGroup::new("factcheck").unwrap()).unwrap();
        let error = bot
            .use_command_group(CommandGroup::new("factcheck").unwrap())
            .unwrap_err();

        assert_eq!(
            error,
            MatrixBotError::DuplicateCommandGroup {
                name: "factcheck".to_owned()
            }
        );
    }

    #[test]
    fn rejects_duplicate_listener_names() {
        let mut bot = MatrixBot::new(config()).unwrap();

        bot.use_listener(Listener::new("watcher").unwrap()).unwrap();
        let error = bot.use_listener(Listener::new("watcher").unwrap()).unwrap_err();

        assert_eq!(
            error,
            MatrixBotError::DuplicateListener {
                name: "watcher".to_owned()
            }
        );
    }

    #[test]
    fn builds_listener_dispatch_plan_in_mount_order() {
        let mut bot = MatrixBot::new(config()).unwrap();
        let mut watcher = Listener::new("watcher").unwrap();
        let mut image_indexer = Listener::new("image-indexer").unwrap();

        watcher.on_matrix_message(ListenerMatrixMessageTrigger::new(HandlerBinding::new("js")));
        image_indexer.on_matrix_message(
            ListenerMatrixMessageTrigger::new(HandlerBinding::new("js"))
                .with_message_types(vec!["image".to_owned()]),
        );
        bot.use_listener(watcher).unwrap();
        bot.use_listener(image_indexer).unwrap();

        let ctx = MatrixContext::new(
            IncomingMessage::new(
                "$event",
                "!room:example.org",
                "@user:example.org",
                "hello",
            ),
            "@bot:example.org",
        );
        let plan = bot.listener_dispatch_plan(&ctx);

        let mounted_names = plan
            .listeners()
            .iter()
            .map(|route| route.listener_name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(mounted_names, vec!["watcher"]);
    }

    #[test]
    fn builds_dispatch_plan_across_command_groups_in_mount_order() {
        let mut bot = MatrixBot::new(config()).unwrap();
        let mut factcheck = CommandGroup::new("factcheck").unwrap();
        let mut imdb = CommandGroup::new("imdb").unwrap();

        factcheck.use_route(RouteLayer::new(
            RouteMatcher::prefix("!"),
            HandlerBinding::new("factcheck_handler"),
        ));
        imdb.use_route(RouteLayer::new(
            RouteMatcher::prefix("!"),
            HandlerBinding::new("imdb_handler"),
        ));
        bot.use_command_group(factcheck).unwrap();
        bot.use_command_group(imdb).unwrap();

        let ctx = MatrixContext::new(
            IncomingMessage::new(
                "$event",
                "!room:example.org",
                "@user:example.org",
                "!check x",
            ),
            "@bot:example.org",
        );
        let plan = bot.dispatch_plan(&ctx);

        let mounted_names = plan
            .routes()
            .iter()
            .map(|route| route.command_group_name.as_str())
            .collect::<Vec<_>>();
        let handlers = plan
            .routes()
            .iter()
            .map(|route| match route.steps.last().unwrap() {
                DispatchStep::Handler(binding) => binding.name(),
                DispatchStep::Middleware(_) => unreachable!("last dispatch step is handler"),
            })
            .collect::<Vec<_>>();

        assert_eq!(mounted_names, vec!["factcheck", "imdb"]);
        assert_eq!(handlers, vec!["factcheck_handler", "imdb_handler"]);
    }
}
