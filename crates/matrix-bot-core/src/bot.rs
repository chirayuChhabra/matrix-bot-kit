use std::collections::HashSet;

use crate::{
    Ajent, AjentDispatchPlan, DispatchPlan, MatrixBotConfig, MatrixBotError, MatrixContext, Result,
    SubBot,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListenOptions {
    pub owners: Vec<String>,
}

impl ListenOptions {
    pub fn new(owners: Vec<String>) -> Result<Self> {
        if owners.iter().all(|owner| owner.trim().is_empty()) {
            return Err(MatrixBotError::MissingField { field: "owners" });
        }

        Ok(Self { owners })
    }
}

#[derive(Debug)]
pub struct MatrixBot {
    config: MatrixBotConfig,
    sub_bots: Vec<SubBot>,
    sub_bot_names: HashSet<String>,
    ajents: Vec<Ajent>,
    ajent_names: HashSet<String>,
}

impl MatrixBot {
    pub fn new(config: MatrixBotConfig) -> Result<Self> {
        config.validate()?;
        Ok(Self {
            config,
            sub_bots: Vec::new(),
            sub_bot_names: HashSet::new(),
            ajents: Vec::new(),
            ajent_names: HashSet::new(),
        })
    }

    pub fn config(&self) -> &MatrixBotConfig {
        &self.config
    }

    pub fn sub_bots(&self) -> &[SubBot] {
        &self.sub_bots
    }

    pub fn ajents(&self) -> &[Ajent] {
        &self.ajents
    }

    pub fn use_sub_bot(&mut self, sub_bot: SubBot) -> Result<()> {
        if !self.sub_bot_names.insert(sub_bot.name().to_owned()) {
            return Err(MatrixBotError::DuplicateSubBot {
                name: sub_bot.name().to_owned(),
            });
        }

        self.sub_bots.push(sub_bot);
        Ok(())
    }

    pub fn use_ajent(&mut self, ajent: Ajent) -> Result<()> {
        if !self.ajent_names.insert(ajent.name().to_owned()) {
            return Err(MatrixBotError::DuplicateAjent {
                name: ajent.name().to_owned(),
            });
        }

        self.ajents.push(ajent);
        Ok(())
    }

    pub fn dispatch_plan(&self, ctx: &MatrixContext) -> DispatchPlan {
        crate::dispatch::build_dispatch_plan(&self.sub_bots, ctx)
    }

    pub fn ajent_dispatch_plan(&self, ctx: &MatrixContext) -> AjentDispatchPlan {
        crate::dispatch::build_ajent_dispatch_plan(&self.ajents, ctx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AjentMatrixMessageTrigger, DispatchStep, HandlerBinding, IncomingMessage, RouteLayer,
        RouteMatcher,
    };

    fn config() -> MatrixBotConfig {
        MatrixBotConfig::new(
            "https://matrix.example.org",
            "@bot:example.org",
            "secret",
            "recovery",
        )
        .unwrap()
    }

    #[test]
    fn registers_sub_bots_in_order() {
        let mut bot = MatrixBot::new(config()).unwrap();

        bot.use_sub_bot(SubBot::new("factcheck").unwrap()).unwrap();
        bot.use_sub_bot(SubBot::new("imdb").unwrap()).unwrap();

        let names = bot.sub_bots().iter().map(SubBot::name).collect::<Vec<_>>();
        assert_eq!(names, vec!["factcheck", "imdb"]);
    }

    #[test]
    fn rejects_duplicate_sub_bot_names() {
        let mut bot = MatrixBot::new(config()).unwrap();

        bot.use_sub_bot(SubBot::new("factcheck").unwrap()).unwrap();
        let error = bot
            .use_sub_bot(SubBot::new("factcheck").unwrap())
            .unwrap_err();

        assert_eq!(
            error,
            MatrixBotError::DuplicateSubBot {
                name: "factcheck".to_owned()
            }
        );
    }

    #[test]
    fn rejects_duplicate_ajent_names() {
        let mut bot = MatrixBot::new(config()).unwrap();

        bot.use_ajent(Ajent::new("watcher").unwrap()).unwrap();
        let error = bot.use_ajent(Ajent::new("watcher").unwrap()).unwrap_err();

        assert_eq!(
            error,
            MatrixBotError::DuplicateAjent {
                name: "watcher".to_owned()
            }
        );
    }

    #[test]
    fn builds_ajent_dispatch_plan_in_mount_order() {
        let mut bot = MatrixBot::new(config()).unwrap();
        let mut watcher = Ajent::new("watcher").unwrap();
        let mut image_indexer = Ajent::new("image-indexer").unwrap();

        watcher.on_matrix_message(AjentMatrixMessageTrigger::new(HandlerBinding::new("js")));
        image_indexer.on_matrix_message(
            AjentMatrixMessageTrigger::new(HandlerBinding::new("js"))
                .with_message_types(vec!["image".to_owned()]),
        );
        bot.use_ajent(watcher).unwrap();
        bot.use_ajent(image_indexer).unwrap();

        let ctx = MatrixContext::new(
            IncomingMessage::new(
                "$event",
                "!room:example.org",
                "@user:example.org",
                "hello",
            ),
            "@bot:example.org",
        );
        let plan = bot.ajent_dispatch_plan(&ctx);

        let mounted_names = plan
            .ajents()
            .iter()
            .map(|route| route.ajent_name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(mounted_names, vec!["watcher"]);
    }

    #[test]
    fn builds_dispatch_plan_across_sub_bots_in_mount_order() {
        let mut bot = MatrixBot::new(config()).unwrap();
        let mut factcheck = SubBot::new("factcheck").unwrap();
        let mut imdb = SubBot::new("imdb").unwrap();

        factcheck.use_route(RouteLayer::new(
            RouteMatcher::prefix("!"),
            HandlerBinding::new("factcheck_handler"),
        ));
        imdb.use_route(RouteLayer::new(
            RouteMatcher::prefix("!"),
            HandlerBinding::new("imdb_handler"),
        ));
        bot.use_sub_bot(factcheck).unwrap();
        bot.use_sub_bot(imdb).unwrap();

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
            .map(|route| route.sub_bot_name.as_str())
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
