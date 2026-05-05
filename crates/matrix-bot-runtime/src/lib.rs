mod client;
mod error;
mod events;
mod sync;

pub use client::MatrixRuntime;
pub use error::{MatrixRuntimeError, RuntimeResult};
pub use events::incoming_message_from_room_event;
pub use sync::SyncLoopOptions;
