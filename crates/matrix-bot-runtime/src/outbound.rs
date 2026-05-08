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

pub async fn send_poll(room: &Room, poll: Poll) -> RuntimeResult<()> {
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
    let poll_start = UnstablePollStartContentBlock::new(poll.question, answers);
    let content = UnstablePollStartEventContent::New(NewUnstablePollStartEventContent::plain_text(
        fallback, poll_start,
    ));

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
