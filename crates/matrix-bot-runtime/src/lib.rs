mod client;
mod error;
mod events;
mod outbound;
mod sync;

pub use client::MatrixRuntime;
pub use error::{MatrixRuntimeError, RuntimeResult};
pub use events::incoming_message_from_room_event;
pub use outbound::{
    send_markdown_notice, send_markdown_reply, send_plain_notice, send_plain_reply,
};
pub use sync::SyncLoopOptions;
