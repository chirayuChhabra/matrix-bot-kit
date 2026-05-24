use std::{path::PathBuf, sync::Arc, time::Duration};

use matrix_bot_core::{
    Ajent as CoreAjent, AjentMatrixMessageTrigger, HandlerBinding, IncomingMessage,
    MatrixBotConfig, MatrixContext, ReplyTarget, RouteLayer, RouteMatcher, SubBot as CoreSubBot,
};
use matrix_bot_runtime::{
    MatrixRuntime, MediaAttachment, MediaAttachmentKind, Poll, PollOption, SyncLoopOptions,
    download_media_from_room_event, incoming_message_from_room_event, incoming_poll_from_event,
    incoming_unstable_poll_from_event, send_markdown_notice, send_markdown_reply,
    send_media_attachment, send_plain_notice, send_plain_reply, send_poll,
};
use matrix_sdk::{
    Client, Room, RoomState,
    ruma::{
        OwnedEventId, OwnedRoomId,
        events::{
            poll::{
                start::OriginalSyncPollStartEvent,
                unstable_start::OriginalSyncUnstablePollStartEvent,
            },
            room::member::StrippedRoomMemberEvent,
            room::message::OriginalSyncRoomMessageEvent,
        },
    },
};
use napi::{bindgen_prelude::*, threadsafe_function::ThreadsafeFunctionCallMode};
use napi_derive::napi;

type MessageCallback = napi::threadsafe_function::ThreadsafeFunction<
    NativeIncomingMessage,
    (),
    NativeIncomingMessage,
    napi::Status,
    false,
>;
type RuntimeLogCallback = napi::threadsafe_function::ThreadsafeFunction<
    NativeRuntimeLog,
    (),
    NativeRuntimeLog,
    napi::Status,
    false,
>;
type RuntimeLogger = Arc<RuntimeLogCallback>;

#[napi(object)]
pub struct MatrixBotOptions {
    pub homeserver_url: String,
    pub username: String,
    pub password: String,
    pub recovery_key: String,
    pub data_dir: Option<String>,
}

#[napi(object)]
pub struct NativeListenOptions {
    pub owners: Vec<String>,
    pub timeline_limit: Option<u32>,
}

#[napi(object)]
pub struct NativeAjentMatrixMessageTrigger {
    pub message_types: Option<Vec<String>>,
}

#[napi(object)]
pub struct NativeIncomingMessage {
    pub event_id: String,
    pub room_id: String,
    pub sender: String,
    pub message_type: String,
    pub body: String,
    pub media: Option<NativeMediaMessage>,
    pub poll: Option<NativePollMessage>,
    pub replied_message: Option<NativeRepliedMessage>,
    pub reply_unsupported: bool,
}

#[napi(object)]
pub struct NativeRuntimeLog {
    pub level: String,
    pub message: String,
}

#[napi(object)]
pub struct NativeMediaMessage {
    pub kind: String,
    pub filename: String,
    pub caption: Option<String>,
    pub mxc_uri: Option<String>,
    pub mimetype: Option<String>,
    pub size: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub encrypted: bool,
}

#[napi(object)]
pub struct NativePollMessage {
    pub question: String,
    pub kind: String,
    pub max_selections: i64,
    pub answers: Vec<NativePollAnswer>,
}

#[napi(object)]
pub struct NativePollAnswer {
    pub id: String,
    pub text: String,
}

#[napi(object)]
pub struct NativeRepliedMessage {
    pub event_id: String,
    pub sender: String,
    pub message_type: String,
    pub body: String,
    pub media: Option<NativeMediaMessage>,
}

#[napi(object)]
pub struct NativeMediaAttachment {
    pub filename: String,
    pub content_type: String,
    pub data: Buffer,
}

#[napi(object)]
pub struct NativePoll {
    pub question: String,
    pub answers: Vec<NativePollAnswer>,
}

#[napi]
pub struct MatrixBot {
    inner: matrix_bot_core::MatrixBot,
    client: Arc<std::sync::Mutex<Option<Client>>>,
}

#[napi]
impl MatrixBot {
    #[napi(constructor)]
    pub fn new(options: MatrixBotOptions) -> Result<Self> {
        let mut config = MatrixBotConfig::new(
            options.homeserver_url,
            options.username,
            options.password,
            options.recovery_key,
        )
        .map_err(to_napi_error)?;

        if let Some(data_dir) = options.data_dir {
            config = config
                .with_data_dir(PathBuf::from(data_dir))
                .map_err(to_napi_error)?;
        }

        Ok(Self {
            inner: matrix_bot_core::MatrixBot::new(config).map_err(to_napi_error)?,
            client: Arc::new(std::sync::Mutex::new(None)),
        })
    }

    #[napi]
    pub fn register_sub_bot(&mut self, sub_bot: &SubBot) -> Result<()> {
        self.inner
            .use_sub_bot(sub_bot.inner.clone())
            .map_err(to_napi_error)
    }

    #[napi]
    pub fn register_ajent(&mut self, ajent: &Ajent) -> Result<()> {
        self.inner
            .use_ajent(ajent.inner.clone())
            .map_err(to_napi_error)
    }

    #[napi(getter)]
    pub fn sub_bot_count(&self) -> u32 {
        self.inner.sub_bots().len() as u32
    }

    #[napi(getter)]
    pub fn ajent_count(&self) -> u32 {
        self.inner.ajents().len() as u32
    }

    #[napi]
    pub fn start(
        &self,
        options: NativeListenOptions,
        on_message: Function<'static, NativeIncomingMessage, ()>,
        on_log: Function<'static, NativeRuntimeLog, ()>,
    ) -> Result<()> {
        if options.owners.iter().all(|owner| owner.trim().is_empty()) {
            return Err(Error::from_reason("owners is required"));
        }

        let callback = Arc::new(
            on_message
                .build_threadsafe_function::<NativeIncomingMessage>()
                .callee_handled::<false>()
                .build()
                .map_err(to_napi_error)?,
        );
        let logger = Arc::new(
            on_log
                .build_threadsafe_function::<NativeRuntimeLog>()
                .callee_handled::<false>()
                .build()
                .map_err(to_napi_error)?,
        );
        let config = self.inner.config().clone();
        let owners = Arc::new(options.owners);
        let timeline_limit = options.timeline_limit.unwrap_or(20) as u64;
        let sync_options = SyncLoopOptions::new(timeline_limit).map_err(to_napi_error)?;
        let stored_client = self.client.clone();
        let sub_bots = Arc::new(self.inner.sub_bots().to_vec());
        let ajents = Arc::new(self.inner.ajents().to_vec());

        std::thread::spawn(move || {
            let logger_for_thread = logger.clone();
            let runtime = match tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    emit_runtime_log(
                        &logger_for_thread,
                        "error",
                        format!("failed to start Matrix runtime: {error}"),
                    );
                    return;
                }
            };

            runtime.block_on(async move {
                let runtime = match MatrixRuntime::connect(config).await {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        emit_runtime_log(
                            &logger,
                            "error",
                            format!("failed to connect Matrix bot: {error}"),
                        );
                        return;
                    }
                };
                let client = runtime.client().clone();

                if let Ok(mut stored_client) = stored_client.lock() {
                    *stored_client = Some(client.clone());
                }

                emit_runtime_log(&logger, "info", "Matrix bot connected");
                register_invite_handler(client.clone(), owners.clone(), logger.clone());
                register_event_handlers(client.clone(), sub_bots, ajents, callback, logger.clone());

                let mut next_batch = match runtime.sync_once(None, &sync_options).await {
                    Ok(next_batch) => next_batch,
                    Err(error) => {
                        emit_runtime_log(
                            &logger,
                            "error",
                            format!("initial Matrix sync failed: {error}"),
                        );
                        return;
                    }
                };
                emit_runtime_log(&logger, "info", "Initial Matrix sync completed");

                loop {
                    match runtime
                        .sync_once(Some(next_batch.clone()), &sync_options)
                        .await
                    {
                        Ok(response_next_batch) => {
                            next_batch = response_next_batch;
                        }
                        Err(error) => {
                            emit_runtime_log(
                                &logger,
                                "warn",
                                format!("Matrix sync failed: {error}; retrying in 5s"),
                            );
                            tokio::time::sleep(Duration::from_secs(5)).await;
                        }
                    }
                }
            });
        });

        Ok(())
    }

    #[napi]
    pub async fn send_text(&self, room_id: String, body: String) -> Result<()> {
        let room = self.room(room_id)?;
        send_plain_notice(&room, body).await.map_err(to_napi_error)
    }

    #[napi]
    pub async fn send_markdown(&self, room_id: String, body: String) -> Result<()> {
        let room = self.room(room_id)?;
        send_markdown_notice(&room, body)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn send_image(
        &self,
        room_id: String,
        attachment: NativeMediaAttachment,
    ) -> Result<()> {
        self.send_media(room_id, attachment, MediaAttachmentKind::Image)
            .await
    }

    #[napi]
    pub async fn send_file(
        &self,
        room_id: String,
        attachment: NativeMediaAttachment,
    ) -> Result<()> {
        self.send_media(room_id, attachment, MediaAttachmentKind::File)
            .await
    }

    #[napi]
    pub async fn send_video(
        &self,
        room_id: String,
        attachment: NativeMediaAttachment,
    ) -> Result<()> {
        self.send_media(room_id, attachment, MediaAttachmentKind::Video)
            .await
    }

    #[napi]
    pub async fn send_poll(&self, room_id: String, poll: NativePoll) -> Result<()> {
        let room = self.room(room_id)?;
        send_poll(
            &room,
            Poll {
                question: poll.question,
                answers: poll
                    .answers
                    .into_iter()
                    .map(|answer| PollOption {
                        id: answer.id,
                        text: answer.text,
                    })
                    .collect(),
            },
        )
        .await
        .map_err(to_napi_error)
    }

    #[napi]
    pub async fn reply_text(&self, room_id: String, event_id: String, body: String) -> Result<()> {
        let room = self.room(room_id)?;
        send_plain_reply(&room, owned_event_id(event_id)?, body)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn reply_markdown(
        &self,
        room_id: String,
        event_id: String,
        body: String,
    ) -> Result<()> {
        let room = self.room(room_id)?;
        send_markdown_reply(&room, owned_event_id(event_id)?, body)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn download_media(&self, room_id: String, event_id: String) -> Result<Buffer> {
        let room = self.room(room_id)?;
        let data = download_media_from_room_event(&room, owned_event_id(event_id)?)
            .await
            .map_err(to_napi_error)?;
        Ok(Buffer::from(data))
    }

    fn room(&self, room_id: String) -> Result<Room> {
        let room_id = OwnedRoomId::try_from(room_id).map_err(to_napi_error)?;
        let client = self
            .client
            .lock()
            .map_err(|_| Error::from_reason("Matrix client mutex poisoned"))?
            .clone()
            .ok_or_else(|| Error::from_reason("Matrix bot is not listening yet"))?;

        client
            .get_room(&room_id)
            .ok_or_else(|| Error::from_reason(format!("room not found: {room_id}")))
    }

    async fn send_media(
        &self,
        room_id: String,
        attachment: NativeMediaAttachment,
        kind: MediaAttachmentKind,
    ) -> Result<()> {
        let room = self.room(room_id)?;
        send_media_attachment(
            &room,
            MediaAttachment {
                kind,
                filename: attachment.filename,
                content_type: attachment.content_type,
                data: attachment.data.to_vec(),
            },
        )
        .await
        .map_err(to_napi_error)
    }
}

#[napi]
pub struct SubBot {
    inner: CoreSubBot,
}

#[napi]
impl SubBot {
    #[napi(constructor)]
    pub fn new(name: String, commands: Option<Vec<String>>) -> Result<Self> {
        let mut inner = CoreSubBot::new(name).map_err(to_napi_error)?;
        if let Some(commands) = commands {
            for command in commands {
                inner.use_route(RouteLayer::new(
                    RouteMatcher::command(command),
                    HandlerBinding::new("js"),
                ));
            }
        }

        Ok(Self { inner })
    }

    #[napi(getter)]
    pub fn name(&self) -> String {
        self.inner.name().to_owned()
    }
}

#[napi]
pub struct Ajent {
    inner: CoreAjent,
}

#[napi]
impl Ajent {
    #[napi(constructor)]
    pub fn new(
        name: String,
        matrix_message_triggers: Option<Vec<NativeAjentMatrixMessageTrigger>>,
    ) -> Result<Self> {
        let mut inner = CoreAjent::new(name).map_err(to_napi_error)?;
        if let Some(triggers) = matrix_message_triggers {
            for trigger in triggers {
                let mut matrix_trigger =
                    AjentMatrixMessageTrigger::new(HandlerBinding::new("js"));
                if let Some(message_types) = trigger.message_types {
                    matrix_trigger = matrix_trigger.with_message_types(message_types);
                }
                inner.on_matrix_message(matrix_trigger);
            }
        }

        Ok(Self { inner })
    }

    #[napi(getter)]
    pub fn name(&self) -> String {
        self.inner.name().to_owned()
    }
}

fn to_napi_error(error: impl std::fmt::Display) -> Error {
    Error::from_reason(error.to_string())
}

fn emit_runtime_log(logger: &RuntimeLogger, level: impl Into<String>, message: impl Into<String>) {
    logger.call(
        NativeRuntimeLog {
            level: level.into(),
            message: message.into(),
        },
        ThreadsafeFunctionCallMode::NonBlocking,
    );
}

fn register_invite_handler(client: Client, owners: Arc<Vec<String>>, logger: RuntimeLogger) {
    client.add_event_handler(
        move |event: StrippedRoomMemberEvent, client: Client, room: Room| {
            let owners = owners.clone();
            let logger = logger.clone();
            async move {
                if event.state_key != client.user_id().expect("logged in client") {
                    return;
                }

                if owners.iter().any(|owner| owner == event.sender.as_str()) {
                    if let Err(error) = room.join().await {
                        emit_runtime_log(
                            &logger,
                            "warn",
                            format!("failed to join {}: {error}", room.room_id()),
                        );
                    } else {
                        emit_runtime_log(
                            &logger,
                            "info",
                            format!("accepted invite to {}", room.room_id()),
                        );
                    }
                } else if let Err(error) = room.leave().await {
                    emit_runtime_log(
                        &logger,
                        "warn",
                        format!("failed to reject invite to {}: {error}", room.room_id()),
                    );
                } else {
                    emit_runtime_log(
                        &logger,
                        "info",
                        format!("rejected invite to {}", room.room_id()),
                    );
                }
            }
        },
    );
}

fn register_event_handlers(
    client: Client,
    sub_bots: Arc<Vec<CoreSubBot>>,
    ajents: Arc<Vec<CoreAjent>>,
    callback: Arc<MessageCallback>,
    logger: RuntimeLogger,
) {
    register_message_handler(
        client.clone(),
        sub_bots.clone(),
        ajents.clone(),
        callback.clone(),
        logger.clone(),
    );
    register_poll_handler(
        client.clone(),
        sub_bots.clone(),
        ajents.clone(),
        callback.clone(),
        logger.clone(),
    );
    register_unstable_poll_handler(client, sub_bots, ajents, callback, logger);
}

fn register_message_handler(
    client: Client,
    sub_bots: Arc<Vec<CoreSubBot>>,
    ajents: Arc<Vec<CoreAjent>>,
    callback: Arc<MessageCallback>,
    logger: RuntimeLogger,
) {
    client.add_event_handler(
        move |event: OriginalSyncRoomMessageEvent, room: Room, client: Client| {
            let callback = Arc::clone(&callback);
            let logger = logger.clone();
            async move {
                if room.state() != RoomState::Joined {
                    return;
                }

                if Some(event.sender.as_ref()) == client.user_id().map(|id| id.as_str()) {
                    return;
                }

                match incoming_message_from_room_event(&event, &room).await {
                    Ok(Some(message)) => {
                        let bot_user_id = client
                            .user_id()
                            .expect("logged in client")
                            .as_str()
                            .to_owned();
                        if should_skip_js_dispatch(&sub_bots, &ajents, &message, bot_user_id) {
                            return;
                        }

                        callback.call(message.into(), ThreadsafeFunctionCallMode::NonBlocking);
                    }
                    Ok(None) => {}
                    Err(error) => emit_runtime_log(
                        &logger,
                        "warn",
                        format!("message conversion failed: {error}"),
                    ),
                }
            }
        },
    );
}

fn register_poll_handler(
    client: Client,
    sub_bots: Arc<Vec<CoreSubBot>>,
    ajents: Arc<Vec<CoreAjent>>,
    callback: Arc<MessageCallback>,
    logger: RuntimeLogger,
) {
    client.add_event_handler(
        move |event: OriginalSyncPollStartEvent, room: Room, client: Client| {
            let callback = Arc::clone(&callback);
            let logger = logger.clone();
            async move {
                if room.state() != RoomState::Joined {
                    return;
                }

                if Some(event.sender.as_ref()) == client.user_id().map(|id| id.as_str()) {
                    return;
                }

                let message = incoming_poll_from_event(&event, &room);
                let bot_user_id = client
                    .user_id()
                    .expect("logged in client")
                    .as_str()
                    .to_owned();
                if should_skip_js_dispatch(&sub_bots, &ajents, &message, bot_user_id) {
                    return;
                }

                callback.call(message.into(), ThreadsafeFunctionCallMode::NonBlocking);
                emit_runtime_log(&logger, "debug", "dispatched poll event to JavaScript");
            }
        },
    );
}

fn register_unstable_poll_handler(
    client: Client,
    sub_bots: Arc<Vec<CoreSubBot>>,
    ajents: Arc<Vec<CoreAjent>>,
    callback: Arc<MessageCallback>,
    logger: RuntimeLogger,
) {
    client.add_event_handler(
        move |event: OriginalSyncUnstablePollStartEvent, room: Room, client: Client| {
            let callback = Arc::clone(&callback);
            let logger = logger.clone();
            async move {
                if room.state() != RoomState::Joined {
                    return;
                }

                if Some(event.sender.as_ref()) == client.user_id().map(|id| id.as_str()) {
                    return;
                }

                if let Some(message) = incoming_unstable_poll_from_event(&event, &room) {
                    let bot_user_id = client
                        .user_id()
                        .expect("logged in client")
                        .as_str()
                        .to_owned();
                    if should_skip_js_dispatch(&sub_bots, &ajents, &message, bot_user_id) {
                        return;
                    }

                    callback.call(message.into(), ThreadsafeFunctionCallMode::NonBlocking);
                    emit_runtime_log(
                        &logger,
                        "debug",
                        "dispatched unstable poll event to JavaScript",
                    );
                }
            }
        },
    );
}

fn owned_event_id(event_id: String) -> Result<OwnedEventId> {
    OwnedEventId::try_from(event_id).map_err(to_napi_error)
}

fn should_skip_js_dispatch(
    sub_bots: &[CoreSubBot],
    ajents: &[CoreAjent],
    message: &IncomingMessage,
    bot_user_id: String,
) -> bool {
    let context = MatrixContext::new(message.clone(), bot_user_id);
    matrix_bot_core::build_dispatch_plan(sub_bots, &context).is_empty()
        && matrix_bot_core::build_ajent_dispatch_plan(ajents, &context).is_empty()
}

impl From<IncomingMessage> for NativeIncomingMessage {
    fn from(message: IncomingMessage) -> Self {
        let (replied_message, reply_unsupported) = match message.reply_target {
            ReplyTarget::Text(message) => (
                Some(NativeRepliedMessage {
                    event_id: message.event_id,
                    sender: message.sender,
                    message_type: message.message_type,
                    body: message.body,
                    media: message.media.map(native_media_message_from),
                }),
                false,
            ),
            ReplyTarget::Unsupported { .. } => (None, true),
            ReplyTarget::NoReply => (None, false),
        };

        Self {
            event_id: message.event_id,
            room_id: message.room_id,
            sender: message.sender,
            message_type: message.message_type,
            body: message.body,
            media: message.media.map(native_media_message_from),
            poll: message.poll.map(|poll| NativePollMessage {
                question: poll.question,
                kind: poll.kind,
                max_selections: u64_to_i64(poll.max_selections).unwrap_or(i64::MAX),
                answers: poll
                    .answers
                    .into_iter()
                    .map(|answer| NativePollAnswer {
                        id: answer.id,
                        text: answer.text,
                    })
                    .collect(),
            }),
            replied_message,
            reply_unsupported,
        }
    }
}

fn native_media_message_from(media: matrix_bot_core::MediaMessage) -> NativeMediaMessage {
    NativeMediaMessage {
        kind: media.kind,
        filename: media.filename,
        caption: media.caption,
        mxc_uri: media.mxc_uri,
        mimetype: media.mimetype,
        size: media.size.and_then(u64_to_i64),
        width: media.width.and_then(u64_to_i64),
        height: media.height.and_then(u64_to_i64),
        duration_ms: media.duration_ms.and_then(u64_to_i64),
        encrypted: media.encrypted,
    }
}

fn u64_to_i64(value: u64) -> Option<i64> {
    value.try_into().ok()
}
