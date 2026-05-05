use matrix_sdk::{
    config::SyncSettings,
    ruma::{
        UInt,
        api::client::{filter::FilterDefinition, sync::sync_events::v3::Filter},
    },
};

use crate::{MatrixRuntimeError, RuntimeResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncLoopOptions {
    pub timeline_limit: u64,
}

impl Default for SyncLoopOptions {
    fn default() -> Self {
        Self { timeline_limit: 20 }
    }
}

impl SyncLoopOptions {
    pub fn new(timeline_limit: u64) -> RuntimeResult<Self> {
        if timeline_limit == 0 {
            return Err(MatrixRuntimeError::InvalidSyncOption(
                "timeline_limit must be greater than zero",
            ));
        }

        if UInt::new(timeline_limit).is_none() {
            return Err(MatrixRuntimeError::InvalidSyncOption(
                "timeline_limit exceeds Matrix integer limits",
            ));
        }

        Ok(Self { timeline_limit })
    }
}

pub fn sync_settings(token: Option<String>, options: &SyncLoopOptions) -> SyncSettings {
    let mut filter = FilterDefinition::default();
    filter.room.timeline.limit = UInt::new(options.timeline_limit);

    let settings = SyncSettings::default().filter(Filter::FilterDefinition(filter));
    match token {
        Some(token) => settings.token(token),
        None => settings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_zero_timeline_limit() {
        let error = SyncLoopOptions::new(0).unwrap_err();

        assert!(matches!(
            error,
            MatrixRuntimeError::InvalidSyncOption("timeline_limit must be greater than zero")
        ));
    }

    #[test]
    fn defaults_to_small_backlog_limit() {
        assert_eq!(SyncLoopOptions::default().timeline_limit, 20);
    }
}
