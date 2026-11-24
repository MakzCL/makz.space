use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("device not found: {0}")]
    DeviceNotFound(String),
    #[error("unsupported on this device: {0}")]
    Unsupported(String),
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error("i/o: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, Error>;
