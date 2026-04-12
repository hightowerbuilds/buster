#[derive(Debug, thiserror::Error)]
pub enum RemoteError {
    #[error("config error: {0}")]
    Config(String),
}
