#[derive(Debug, thiserror::Error)]
pub enum RemoteError {
    #[error("connection failed: {host}: {reason}")]
    ConnectionFailed { host: String, reason: String },

    #[error("authentication failed: {host}: {method}")]
    AuthFailed { host: String, method: String },

    #[error("host key verification failed: {host}")]
    HostKeyMismatch { host: String },

    #[error("no connection to {host}")]
    NotConnected { host: String },

    #[error("transfer failed: {path}: {reason}")]
    TransferFailed { path: String, reason: String },

    #[error("command failed on {host}: {reason}")]
    CommandFailed { host: String, reason: String },

    #[error("config error: {0}")]
    Config(String),
}
