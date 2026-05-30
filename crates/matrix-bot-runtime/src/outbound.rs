use matrix_sdk::{
    Room,
    attachment::{AttachmentConfig, AttachmentInfo, BaseImageInfo, BaseVideoInfo},
    room::reply::{EnforceThread, Reply},
    ruma::{
        OwnedEventId,
        events::{
            poll::unstable_start::{
                NewUnstablePollStartEventContent, UnstablePollAnswer, UnstablePollAnswers,
                UnstablePollStartContentBlock, UnstablePollStartEventContent,
            },
            poll::unstable_end::UnstablePollEndEventContent,
            reaction::ReactionEventContent,
            relation::Annotation,
            room::message::{RoomMessageEventContent, RoomMessageEventContentWithoutRelation},
        },
    },
};

use crate::{MatrixRuntimeError, RuntimeResult};

#[derive(Debug, Clone)]
pub enum MediaAttachmentKind {
    Image,
    File,
    Video,
}

#[derive(Debug, Clone)]
pub struct MediaAttachment {
    pub kind: MediaAttachmentKind,
    pub filename: String,
    pub content_type: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct Poll {
    pub question: String,
    pub answers: Vec<PollOption>,
    pub kind: Option<String>,
    pub max_selections: Option<u64>,
    pub action_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PollOption {
    pub id: String,
    pub text: String,
}

pub async fn send_plain_notice(room: &Room, body: impl Into<String>) -> RuntimeResult<()> {
    room.send(RoomMessageEventContent::notice_plain(body.into()))
        .await?;
    Ok(())
}

pub async fn send_markdown_notice(room: &Room, body: impl Into<String>) -> RuntimeResult<()> {
    room.send(RoomMessageEventContent::notice_markdown(body.into()))
        .await?;
    Ok(())
}

pub async fn send_media_attachment(room: &Room, attachment: MediaAttachment) -> RuntimeResult<()> {
    let content_type = attachment
        .content_type
        .parse::<mime::Mime>()
        .map_err(|error| MatrixRuntimeError::Event(format!("invalid MIME type: {error}")))?;
    let config = match attachment.kind {
        MediaAttachmentKind::Image => {
            AttachmentConfig::new().info(AttachmentInfo::Image(BaseImageInfo {
                size: attachment.data.len().try_into().ok(),
                ..Default::default()
            }))
        }
        MediaAttachmentKind::File => AttachmentConfig::new(),
        MediaAttachmentKind::Video => {
            AttachmentConfig::new().info(AttachmentInfo::Video(BaseVideoInfo {
                size: attachment.data.len().try_into().ok(),
                ..Default::default()
            }))
        }
    };

    room.send_attachment(attachment.filename, &content_type, attachment.data, config)
        .await?;
    Ok(())
}

pub async fn send_poll(room: &Room, poll: Poll) -> RuntimeResult<String> {
    let answers: UnstablePollAnswers = poll
        .answers
        .into_iter()
        .map(|answer| UnstablePollAnswer::new(answer.id, answer.text))
        .collect::<Vec<_>>()
        .try_into()
        .map_err(|error| MatrixRuntimeError::Event(format!("invalid poll answers: {error}")))?;
    let fallback = format!(
        "{}\n{}",
        poll.question,
        answers
            .iter()
            .map(|answer| format!("- {}", answer.text))
            .collect::<Vec<_>>()
            .join("\n")
    );
    let mut poll_start = UnstablePollStartContentBlock::new(poll.question, answers);

    if let Some(kind) = poll.kind {
        use matrix_sdk::ruma::events::poll::start::PollKind;
        poll_start.kind = match kind.as_str() {
            "m.undisclosed" | "org.matrix.msc3381.poll.undisclosed" | "undisclosed" => PollKind::Undisclosed,
            _ => PollKind::Disclosed,
        };
    }

    if let Some(max_selections) = poll.max_selections {
        use matrix_sdk::ruma::UInt;
        if let Some(max) = UInt::try_from(max_selections).ok() {
            poll_start.max_selections = max;
        }
    }

    let content = UnstablePollStartEventContent::New(NewUnstablePollStartEventContent::plain_text(
        fallback, poll_start,
    ));

    let mut json_val = serde_json::to_value(&content)
        .map_err(|e| crate::MatrixRuntimeError::Event(e.to_string()))?;
    
    if let Some(action_id) = poll.action_id {
        if let Some(obj) = json_val.as_object_mut() {
            obj.insert(String::from("org.matrix.custom.action_id"), serde_json::json!(action_id));
        }
    }

    let response = room.send_raw("org.matrix.msc3381.poll.start", json_val).await?;
    Ok(response.event_id.to_string())
}

pub async fn close_poll(
    room: &Room,
    poll_event_id: OwnedEventId,
    fallback_text: String,
) -> RuntimeResult<()> {
    let content = UnstablePollEndEventContent::new(
        fallback_text,
        poll_event_id,
    );

    room.send(content).await?;
    Ok(())
}

pub async fn send_plain_reply(
    room: &Room,
    event_id: OwnedEventId,
    body: impl Into<String>,
) -> RuntimeResult<()> {
    let content = RoomMessageEventContentWithoutRelation::notice_plain(body.into());
    send_reply(room, event_id, content).await
}

pub async fn send_markdown_reply(
    room: &Room,
    event_id: OwnedEventId,
    body: impl Into<String>,
) -> RuntimeResult<()> {
    let content = RoomMessageEventContentWithoutRelation::notice_markdown(body.into());
    send_reply(room, event_id, content).await
}

async fn send_reply(
    room: &Room,
    event_id: OwnedEventId,
    content: RoomMessageEventContentWithoutRelation,
) -> RuntimeResult<()> {
    match room
        .make_reply_event(
            content.clone(),
            Reply {
                event_id,
                enforce_thread: EnforceThread::MaybeThreaded,
            },
        )
        .await
    {
        Ok(reply_content) => {
            room.send(reply_content).await?;
        }
        Err(_) => {
            room.send(content.with_relation(None)).await?;
        }
    }

    Ok(())
}

pub async fn send_reaction(
    room: &Room,
    event_id: OwnedEventId,
    key: impl Into<String>,
) -> RuntimeResult<()> {
    room.send(ReactionEventContent::new(Annotation::new(event_id, key.into())))
        .await?;
    Ok(())
}

pub async fn redact(
    room: &Room,
    event_id: &OwnedEventId,
    reason: Option<&str>,
) -> RuntimeResult<()> {
    room.redact(event_id, reason, None)
        .await
        .map_err(|e| crate::MatrixRuntimeError::Event(e.to_string()))?;
    Ok(())
}
