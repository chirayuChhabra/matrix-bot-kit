mod client;
mod error;
mod events;
mod outbound;
mod sync;

pub use client::MatrixRuntime;
pub use error::{MatrixRuntimeError, RuntimeResult};
pub use events::{
    download_media_from_room_event, incoming_message_from_room_event, incoming_poll_from_event,
    incoming_unstable_poll_from_event, incoming_poll_response_from_event,
    incoming_unstable_poll_response_from_event, incoming_poll_end_from_event,
    incoming_unstable_poll_end_from_event,
};
pub use outbound::{
    MediaAttachment, MediaAttachmentKind, Poll, PollOption, send_markdown_notice,
    send_markdown_reply, send_media_attachment, send_plain_notice, send_plain_reply, send_poll,
    close_poll, send_reaction, redact,
};
pub use sync::SyncLoopOptions;
