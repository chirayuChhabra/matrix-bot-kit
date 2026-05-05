use matrix_sdk::{
    Room,
    room::reply::{EnforceThread, Reply},
    ruma::{
        OwnedEventId,
        events::room::message::{RoomMessageEventContent, RoomMessageEventContentWithoutRelation},
    },
};

use crate::RuntimeResult;

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
