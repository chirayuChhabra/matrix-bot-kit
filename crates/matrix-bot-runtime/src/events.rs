use std::time::Duration;

use matrix_bot_core::{
    IncomingMessage, MediaMessage, PollAnswer, PollEndMessage, PollMessage, PollResponseMessage,
    RepliedMessage,
};
use matrix_sdk::{
    Room,
    media::{MediaFormat, MediaRequestParameters},
    ruma::{
        EventId, OwnedEventId,
        events::{
            AnySyncMessageLikeEvent, AnySyncTimelineEvent,
            poll::{
                start::{OriginalSyncPollStartEvent, PollStartEventContent},
                unstable_start::{
                    OriginalSyncUnstablePollStartEvent, UnstablePollStartContentBlock,
                    UnstablePollStartEventContent,
                },
                response::OriginalSyncPollResponseEvent,
                unstable_response::OriginalSyncUnstablePollResponseEvent,
                end::OriginalSyncPollEndEvent,
                unstable_end::OriginalSyncUnstablePollEndEvent,
            },
            room::MediaSource,
            room::message::{
                MessageType, OriginalSyncRoomMessageEvent, Relation,
                RoomMessageEventContentWithoutRelation,
            },
        },
    },
};

use crate::{MatrixRuntimeError, RuntimeResult};

pub async fn incoming_message_from_room_event(
    event: &OriginalSyncRoomMessageEvent,
    room: &Room,
) -> RuntimeResult<Option<IncomingMessage>> {
    let Some((message_type, body, media)) = message_parts(&event.content.msgtype) else {
        return Ok(None);
    };

    let mut message = IncomingMessage::new(
        event.event_id.to_string(),
        room.room_id().to_string(),
        event.sender.to_string(),
        body,
    )
    .with_message_type(message_type)
    .with_is_direct(room.is_direct().await.unwrap_or(false));

    if let Some(media) = media {
        message = message.with_media(media);
    }

    match replied_message(event, room).await? {
        MatrixReplyTarget::Text(replied) => {
            message = message.with_replied_message(replied);
        }
        MatrixReplyTarget::Unsupported(event_id) => {
            message = message.with_unsupported_reply(event_id.to_string());
        }
        MatrixReplyTarget::NoReply => {}
    }

    Ok(Some(message))
}

pub fn incoming_poll_from_event(
    event: &OriginalSyncPollStartEvent,
    room: &Room,
) -> IncomingMessage {
    let poll = poll_from_content(&event.content);
    IncomingMessage::new(
        event.event_id.to_string(),
        room.room_id().to_string(),
        event.sender.to_string(),
        poll.question.clone(),
    )
    .with_message_type("poll")
    .with_poll(poll)
}

pub fn incoming_unstable_poll_from_event(
    event: &OriginalSyncUnstablePollStartEvent,
    room: &Room,
) -> Option<IncomingMessage> {
    let UnstablePollStartEventContent::New(content) = &event.content else {
        return None;
    };
    let poll = unstable_poll_from_content(&content.poll_start);
    Some(
        IncomingMessage::new(
            event.event_id.to_string(),
            room.room_id().to_string(),
            event.sender.to_string(),
            poll.question.clone(),
        )
        .with_message_type("poll")
        .with_poll(poll),
    )
}

pub fn incoming_poll_response_from_event(
    event: &OriginalSyncPollResponseEvent,
    room: &Room,
) -> IncomingMessage {
    let selections: Vec<String> = event
        .content
        .selections
        .iter()
        .map(|s| s.to_string())
        .collect();
    let poll_event_id = event.content.relates_to.event_id.to_string();
    IncomingMessage::new(
        event.event_id.to_string(),
        room.room_id().to_string(),
        event.sender.to_string(),
        String::new(),
    )
    .with_message_type("poll_response")
    .with_poll_response(PollResponseMessage {
        poll_event_id,
        selections,
    })
}

pub fn incoming_unstable_poll_response_from_event(
    event: &OriginalSyncUnstablePollResponseEvent,
    room: &Room,
) -> IncomingMessage {
    let selections: Vec<String> = event
        .content
        .poll_response
        .answers
        .iter()
        .map(|s| s.to_string())
        .collect();
    let poll_event_id = event.content.relates_to.event_id.to_string();
    IncomingMessage::new(
        event.event_id.to_string(),
        room.room_id().to_string(),
        event.sender.to_string(),
        String::new(),
    )
    .with_message_type("poll_response")
    .with_poll_response(PollResponseMessage {
        poll_event_id,
        selections,
    })
}

pub fn incoming_poll_end_from_event(
    event: &OriginalSyncPollEndEvent,
    room: &Room,
) -> IncomingMessage {
    let poll_event_id = event.content.relates_to.event_id.to_string();
    let text = event.content.text.clone();
    let text_plain = text.find_plain().unwrap_or_default().to_owned();
    IncomingMessage::new(
        event.event_id.to_string(),
        room.room_id().to_string(),
        event.sender.to_string(),
        text_plain.clone(),
    )
    .with_message_type("poll_end")
    .with_poll_end(PollEndMessage {
        poll_event_id,
        text: text_plain,
    })
}

pub fn incoming_unstable_poll_end_from_event(
    event: &OriginalSyncUnstablePollEndEvent,
    room: &Room,
) -> IncomingMessage {
    let poll_event_id = event.content.relates_to.event_id.to_string();
    let text = event.content.text.clone();
    IncomingMessage::new(
        event.event_id.to_string(),
        room.room_id().to_string(),
        event.sender.to_string(),
        text.clone(),
    )
    .with_message_type("poll_end")
    .with_poll_end(PollEndMessage {
        poll_event_id,
        text,
    })
}

pub async fn download_media_from_room_event(
    room: &Room,
    event_id: OwnedEventId,
) -> RuntimeResult<Vec<u8>> {
    let event = room.load_or_fetch_event(&event_id, None).await?;
    let timeline_event = event
        .raw()
        .deserialize()
        .map_err(|error| MatrixRuntimeError::Event(error.to_string()))?;

    let AnySyncTimelineEvent::MessageLike(AnySyncMessageLikeEvent::RoomMessage(message)) =
        timeline_event
    else {
        return Err(MatrixRuntimeError::Event(
            "event is not a room message".to_owned(),
        ));
    };

    let Some(message) = message.as_original() else {
        return Err(MatrixRuntimeError::Event(
            "event is not an original room message".to_owned(),
        ));
    };

    let Some(source) = media_source(&message.content.msgtype) else {
        return Err(MatrixRuntimeError::Event(
            "event has no downloadable media".to_owned(),
        ));
    };

    let request = MediaRequestParameters {
        source,
        format: MediaFormat::File,
    };

    Ok(room
        .client()
        .media()
        .get_media_content(&request, true)
        .await?)
}

enum MatrixReplyTarget {
    Text(RepliedMessage),
    Unsupported(OwnedEventId),
    NoReply,
}

fn message_parts(msgtype: &MessageType) -> Option<(String, String, Option<MediaMessage>)> {
    match msgtype {
        MessageType::Text(text) => Some(("text".to_owned(), text.body.trim().to_owned(), None)),
        MessageType::Notice(notice) => {
            Some(("notice".to_owned(), notice.body.trim().to_owned(), None))
        }
        MessageType::ServerNotice(notice) => Some((
            "server_notice".to_owned(),
            notice.body.trim().to_owned(),
            None,
        )),
        MessageType::Image(image) => Some((
            "image".to_owned(),
            image
                .caption()
                .unwrap_or_else(|| image.filename())
                .trim()
                .to_owned(),
            Some(MediaMessage {
                kind: "image".to_owned(),
                filename: image.filename().to_owned(),
                caption: image.caption().map(str::to_owned),
                mxc_uri: plain_mxc_uri(&image.source),
                mimetype: image.info.as_ref().and_then(|info| info.mimetype.clone()),
                size: image
                    .info
                    .as_ref()
                    .and_then(|info| info.size.map(Into::into)),
                width: image
                    .info
                    .as_ref()
                    .and_then(|info| info.width.map(Into::into)),
                height: image
                    .info
                    .as_ref()
                    .and_then(|info| info.height.map(Into::into)),
                duration_ms: None,
                encrypted: matches!(image.source, MediaSource::Encrypted(_)),
            }),
        )),
        MessageType::File(file) => Some((
            "file".to_owned(),
            file.caption()
                .unwrap_or_else(|| file.filename())
                .trim()
                .to_owned(),
            Some(MediaMessage {
                kind: "file".to_owned(),
                filename: file.filename().to_owned(),
                caption: file.caption().map(str::to_owned),
                mxc_uri: plain_mxc_uri(&file.source),
                mimetype: file.info.as_ref().and_then(|info| info.mimetype.clone()),
                size: file
                    .info
                    .as_ref()
                    .and_then(|info| info.size.map(Into::into)),
                width: None,
                height: None,
                duration_ms: None,
                encrypted: matches!(file.source, MediaSource::Encrypted(_)),
            }),
        )),
        MessageType::Video(video) => Some((
            "video".to_owned(),
            video
                .caption()
                .unwrap_or_else(|| video.filename())
                .trim()
                .to_owned(),
            Some(MediaMessage {
                kind: "video".to_owned(),
                filename: video.filename().to_owned(),
                caption: video.caption().map(str::to_owned),
                mxc_uri: plain_mxc_uri(&video.source),
                mimetype: video.info.as_ref().and_then(|info| info.mimetype.clone()),
                size: video
                    .info
                    .as_ref()
                    .and_then(|info| info.size.map(Into::into)),
                width: video
                    .info
                    .as_ref()
                    .and_then(|info| info.width.map(Into::into)),
                height: video
                    .info
                    .as_ref()
                    .and_then(|info| info.height.map(Into::into)),
                duration_ms: video
                    .info
                    .as_ref()
                    .and_then(|info| info.duration)
                    .map(duration_millis),
                encrypted: matches!(video.source, MediaSource::Encrypted(_)),
            }),
        )),
        _ => None,
    }
}

fn media_source(msgtype: &MessageType) -> Option<MediaSource> {
    match msgtype {
        MessageType::Image(image) => Some(image.source.clone()),
        MessageType::File(file) => Some(file.source.clone()),
        MessageType::Video(video) => Some(video.source.clone()),
        MessageType::Audio(audio) => Some(audio.source.clone()),
        _ => None,
    }
}

fn plain_mxc_uri(source: &MediaSource) -> Option<String> {
    match source {
        MediaSource::Plain(uri) => Some(uri.to_string()),
        MediaSource::Encrypted(_) => None,
    }
}

fn poll_from_content(content: &PollStartEventContent) -> PollMessage {
    PollMessage {
        question: content
            .poll
            .question
            .text
            .find_plain()
            .unwrap_or_default()
            .to_owned(),
        kind: content.poll.kind.as_ref().to_owned(),
        max_selections: content.poll.max_selections.into(),
        answers: content
            .poll
            .answers
            .iter()
            .map(|answer| PollAnswer {
                id: answer.id.clone(),
                text: answer.text.find_plain().unwrap_or_default().to_owned(),
            })
            .collect(),
    }
}

fn unstable_poll_from_content(content: &UnstablePollStartContentBlock) -> PollMessage {
    PollMessage {
        question: content.question.text.clone(),
        kind: content.kind.as_ref().to_owned(),
        max_selections: content.max_selections.into(),
        answers: content
            .answers
            .iter()
            .map(|answer| PollAnswer {
                id: answer.id.clone(),
                text: answer.text.clone(),
            })
            .collect(),
    }
}

fn duration_millis(duration: Duration) -> u64 {
    duration.as_millis().try_into().unwrap_or(u64::MAX)
}

async fn replied_message(
    event: &OriginalSyncRoomMessageEvent,
    room: &Room,
) -> RuntimeResult<MatrixReplyTarget> {
    let Some(reply_event_id) = replied_to_event_id(&event.content.relates_to) else {
        return Ok(MatrixReplyTarget::NoReply);
    };

    let replied_event = room.load_or_fetch_event(reply_event_id, None).await?;
    let timeline_event = replied_event
        .raw()
        .deserialize()
        .map_err(|error| MatrixRuntimeError::Event(error.to_string()))?;

    let AnySyncTimelineEvent::MessageLike(AnySyncMessageLikeEvent::RoomMessage(message)) =
        timeline_event
    else {
        return Ok(MatrixReplyTarget::Unsupported(reply_event_id.to_owned()));
    };

    let Some(message) = message.as_original() else {
        return Ok(MatrixReplyTarget::Unsupported(reply_event_id.to_owned()));
    };

    let Some((message_type, body, media)) = message_parts(&message.content.msgtype) else {
        return Ok(MatrixReplyTarget::Unsupported(reply_event_id.to_owned()));
    };

    let mut replied =
        RepliedMessage::new(reply_event_id.to_string(), message.sender.to_string(), body)
            .with_message_type(message_type);

    if let Some(media) = media {
        replied = replied.with_media(media);
    }

    Ok(MatrixReplyTarget::Text(replied))
}

fn replied_to_event_id(
    relates_to: &Option<Relation<RoomMessageEventContentWithoutRelation>>,
) -> Option<&EventId> {
    match relates_to {
        Some(Relation::Reply { in_reply_to }) => Some(&in_reply_to.event_id),
        Some(Relation::Thread(thread)) if !thread.is_falling_back => thread
            .in_reply_to
            .as_ref()
            .map(|reply| reply.event_id.as_ref()),
        _ => None,
    }
}
