use matrix_bot_core::MatrixBotConfig;
use matrix_sdk::{
    Client, authentication::matrix::MatrixSession, encryption::EncryptionSettings,
    store::RoomLoadSettings,
};
use tokio::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use url::Url;

use crate::{MatrixRuntimeError, RuntimeResult, SyncLoopOptions, sync::sync_settings};

#[derive(Debug, Clone)]
pub struct MatrixRuntime {
    client: Client,
    config: MatrixBotConfig,
}

impl MatrixRuntime {
    pub async fn connect(config: MatrixBotConfig) -> RuntimeResult<Self> {
        fs::create_dir_all(&config.data_dir).await?;

        let client = build_client(&config).await?;
        login_or_restore(&client, &config).await?;
        recover_crypto(&client, &config).await?;

        Ok(Self { client, config })
    }

    pub fn client(&self) -> &Client {
        &self.client
    }

    pub fn config(&self) -> &MatrixBotConfig {
        &self.config
    }

    pub fn user_id(&self) -> RuntimeResult<String> {
        self.client
            .user_id()
            .map(ToString::to_string)
            .ok_or(MatrixRuntimeError::MissingSessionField("user_id"))
    }

    pub fn device_id(&self) -> RuntimeResult<String> {
        self.client
            .device_id()
            .map(ToString::to_string)
            .ok_or(MatrixRuntimeError::MissingSessionField("device_id"))
    }

    pub async fn sync_once(
        &self,
        token: Option<String>,
        options: &SyncLoopOptions,
    ) -> RuntimeResult<String> {
        let response = self.client.sync_once(sync_settings(token, options)).await?;
        Ok(response.next_batch)
    }
}

async fn build_client(config: &MatrixBotConfig) -> RuntimeResult<Client> {
    let homeserver = Url::parse(&config.homeserver_url)?;
    let store_path = config.data_dir.join("matrix-store");
    let cache_path = config.data_dir.join("matrix-cache");

    Ok(Client::builder()
        .homeserver_url(homeserver)
        .sqlite_store_with_cache_path(store_path, cache_path, None)
        .with_encryption_settings(EncryptionSettings {
            auto_enable_cross_signing: true,
            auto_enable_backups: true,
            ..Default::default()
        })
        .build()
        .await
        .map_err(|error| MatrixRuntimeError::ClientBuild(error.to_string()))?)
}

async fn login_or_restore(client: &Client, config: &MatrixBotConfig) -> RuntimeResult<()> {
    let session_path = config.data_dir.join("matrix-session.json");

    if let Ok(session_json) = fs::read_to_string(&session_path).await {
        let session: MatrixSession = serde_json::from_str(&session_json)?;
        if let Err(e) = client
            .matrix_auth()
            .restore_session(session, RoomLoadSettings::default())
            .await
        {
            println!("Warning: Failed to restore session: {}. Re-authenticating...", e);
        } else {
            return Ok(());
        }
    }

    let response = client
        .matrix_auth()
        .login_username(&config.username, &config.password)
        .initial_device_display_name("Matrix Bot Kit")
        .send()
        .await?;

    let session: MatrixSession = (&response).into();
    fs::write(&session_path, serde_json::to_string_pretty(&session)?).await?;
    
    #[cfg(unix)]
    {
        if let Ok(metadata) = fs::metadata(&session_path).await {
            let mut perms = metadata.permissions();
            perms.set_mode(0o600);
            let _ = fs::set_permissions(&session_path, perms).await;
        }
    }
    
    Ok(())
}

async fn recover_crypto(client: &Client, config: &MatrixBotConfig) -> RuntimeResult<()> {
    let recovery = client.encryption().recovery();
    recovery
        .recover(&config.recovery_key)
        .await
        .map_err(|error| MatrixRuntimeError::Crypto(error.to_string()))?;

    if let Some(device) = client
        .encryption()
        .get_own_device()
        .await
        .map_err(|error| MatrixRuntimeError::Crypto(error.to_string()))?
    {
        if !device.is_cross_signed_by_owner() {
            device
                .verify()
                .await
                .map_err(|error| MatrixRuntimeError::Crypto(error.to_string()))?;
        }
    }

    Ok(())
}
