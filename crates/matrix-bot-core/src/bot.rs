use std::collections::HashSet;

use crate::{DispatchPlan, MatrixBotConfig, MatrixBotError, MatrixContext, Result, SubBot};

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
}

impl MatrixBot {
    pub fn new(config: MatrixBotConfig) -> Result<Self> {
        config.validate()?;
        Ok(Self {
            config,
            sub_bots: Vec::new(),
            sub_bot_names: HashSet::new(),
        })
    }

    pub fn config(&self) -> &MatrixBotConfig {
        &self.config
    }

    pub fn sub_bots(&self) -> &[SubBot] {
        &self.sub_bots
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

    pub fn dispatch_plan(&self, ctx: &MatrixContext) -> DispatchPlan {
        crate::dispatch::build_dispatch_plan(&self.sub_bots, ctx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DispatchStep, HandlerBinding, IncomingMessage, RouteLayer, RouteMatcher};

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
