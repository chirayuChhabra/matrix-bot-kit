use std::{path::PathBuf, sync::Arc, time::Duration};

use matrix_bot_core::{IncomingMessage, MatrixBotConfig, ReplyTarget, SubBot as CoreSubBot};
use matrix_bot_runtime::{
    MatrixRuntime, SyncLoopOptions, incoming_message_from_room_event, send_markdown_notice,
    send_markdown_reply, send_plain_notice, send_plain_reply,
};
use matrix_sdk::{
    Client, Room, RoomState,
    ruma::{
        OwnedEventId, OwnedRoomId,
        events::{
            room::member::StrippedRoomMemberEvent, room::message::OriginalSyncRoomMessageEvent,
        },
    },
};
use napi::{bindgen_prelude::*, threadsafe_function::ThreadsafeFunctionCallMode};
use napi_derive::napi;

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
pub struct NativeIncomingMessage {
    pub event_id: String,
    pub room_id: String,
    pub sender: String,
    pub body: String,
    pub replied_message: Option<NativeRepliedMessage>,
    pub reply_unsupported: bool,
}

#[napi(object)]
pub struct NativeRepliedMessage {
    pub event_id: String,
    pub sender: String,
    pub body: String,
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

    #[napi(getter)]
    pub fn sub_bot_count(&self) -> u32 {
        self.inner.sub_bots().len() as u32
    }

    #[napi]
    pub fn start(
        &self,
        options: NativeListenOptions,
        on_message: Function<'static, NativeIncomingMessage, ()>,
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
        let config = self.inner.config().clone();
        let owners = Arc::new(options.owners);
        let timeline_limit = options.timeline_limit.unwrap_or(20) as u64;
        let sync_options = SyncLoopOptions::new(timeline_limit).map_err(to_napi_error)?;
        let stored_client = self.client.clone();

        std::thread::spawn(move || {
            let runtime = match tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    eprintln!("failed to start Matrix runtime: {error}");
                    return;
                }
            };

            runtime.block_on(async move {
                let runtime = match MatrixRuntime::connect(config).await {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        eprintln!("failed to connect Matrix bot: {error}");
                        return;
                    }
                };
                let client = runtime.client().clone();

                if let Ok(mut stored_client) = stored_client.lock() {
                    *stored_client = Some(client.clone());
                }

                register_invite_handler(client.clone(), owners.clone());
                register_message_handler(client.clone(), callback);

                let mut next_batch = match runtime.sync_once(None, &sync_options).await {
                    Ok(next_batch) => next_batch,
                    Err(error) => {
                        eprintln!("initial Matrix sync failed: {error}");
                        return;
                    }
                };

                loop {
                    match runtime
                        .sync_once(Some(next_batch.clone()), &sync_options)
                        .await
                    {
                        Ok(response_next_batch) => {
                            next_batch = response_next_batch;
                        }
                        Err(error) => {
                            eprintln!("Matrix sync failed: {error}; retrying in 5s");
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
}

#[napi]
pub struct SubBot {
    inner: CoreSubBot,
}

#[napi]
impl SubBot {
    #[napi(constructor)]
    pub fn new(name: String) -> Result<Self> {
        Ok(Self {
            inner: CoreSubBot::new(name).map_err(to_napi_error)?,
        })
    }

    #[napi(getter)]
    pub fn name(&self) -> String {
        self.inner.name().to_owned()
    }
}

fn to_napi_error(error: impl std::fmt::Display) -> Error {
    Error::from_reason(error.to_string())
}

fn register_invite_handler(client: Client, owners: Arc<Vec<String>>) {
    client.add_event_handler(
        move |event: StrippedRoomMemberEvent, client: Client, room: Room| {
            let owners = owners.clone();
            async move {
                if event.state_key != client.user_id().expect("logged in client") {
                    return;
                }

                if owners.iter().any(|owner| owner == event.sender.as_str()) {
                    if let Err(error) = room.join().await {
                        eprintln!("failed to join {}: {error}", room.room_id());
                    }
                } else if let Err(error) = room.leave().await {
                    eprintln!("failed to reject invite to {}: {error}", room.room_id());
                }
            }
        },
    );
}

fn register_message_handler(
    client: Client,
    callback: Arc<
        napi::threadsafe_function::ThreadsafeFunction<
            NativeIncomingMessage,
            (),
            NativeIncomingMessage,
            napi::Status,
            false,
        >,
    >,
) {
    client.add_event_handler(
        move |event: OriginalSyncRoomMessageEvent, room: Room, client: Client| {
            let callback = Arc::clone(&callback);
            async move {
                if room.state() != RoomState::Joined {
                    return;
                }

                if Some(event.sender.as_ref()) == client.user_id().map(|id| id.as_str()) {
                    return;
                }

                match incoming_message_from_room_event(&event, &room).await {
                    Ok(Some(message)) => {
                        callback.call(message.into(), ThreadsafeFunctionCallMode::NonBlocking);
                    }
                    Ok(None) => {}
                    Err(error) => eprintln!("message conversion failed: {error}"),
                }
            }
        },
    );
}

fn owned_event_id(event_id: String) -> Result<OwnedEventId> {
    OwnedEventId::try_from(event_id).map_err(to_napi_error)
}

impl From<IncomingMessage> for NativeIncomingMessage {
    fn from(message: IncomingMessage) -> Self {
        let (replied_message, reply_unsupported) = match message.reply_target {
            ReplyTarget::Text(message) => (
                Some(NativeRepliedMessage {
                    event_id: message.event_id,
                    sender: message.sender,
                    body: message.body,
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
            body: message.body,
            replied_message,
            reply_unsupported,
        }
    }
}
