use matrix_bot_core::{IncomingMessage, RepliedMessage};
use matrix_sdk::{
    Room,
    ruma::{
        EventId, OwnedEventId,
        events::{
            AnySyncMessageLikeEvent, AnySyncTimelineEvent,
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
    let MessageType::Text(text) = &event.content.msgtype else {
        return Ok(None);
    };

    let mut message = IncomingMessage::new(
        event.event_id.to_string(),
        room.room_id().to_string(),
        event.sender.to_string(),
        text.body.trim().to_owned(),
    );

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

enum MatrixReplyTarget {
    Text(RepliedMessage),
    Unsupported(OwnedEventId),
    NoReply,
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

    let body = match &message.content.msgtype {
        MessageType::Text(text) => text.body.trim(),
        MessageType::Notice(notice) => notice.body.trim(),
        MessageType::ServerNotice(notice) => notice.body.trim(),
        _ => return Ok(MatrixReplyTarget::Unsupported(reply_event_id.to_owned())),
    };

    Ok(MatrixReplyTarget::Text(RepliedMessage::new(
        reply_event_id.to_string(),
        message.sender.to_string(),
        body.to_owned(),
    )))
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
