pub type RuntimeResult<T> = std::result::Result<T, MatrixRuntimeError>;

#[derive(Debug)]
pub enum MatrixRuntimeError {
    Url(url::ParseError),
    Matrix(matrix_sdk::Error),
    ClientBuild(String),
    Crypto(String),
    Io(std::io::Error),
    Json(serde_json::Error),
    MissingSessionField(&'static str),
}

impl std::fmt::Display for MatrixRuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Url(error) => write!(formatter, "invalid homeserver URL: {error}"),
            Self::Matrix(error) => write!(formatter, "Matrix client error: {error}"),
            Self::ClientBuild(error) => write!(formatter, "Matrix client build failed: {error}"),
            Self::Crypto(error) => write!(formatter, "Matrix crypto error: {error}"),
            Self::Io(error) => write!(formatter, "I/O error: {error}"),
            Self::Json(error) => write!(formatter, "JSON error: {error}"),
            Self::MissingSessionField(field) => {
                write!(formatter, "Matrix session missing {field} after login")
            }
        }
    }
}

impl std::error::Error for MatrixRuntimeError {}

impl From<url::ParseError> for MatrixRuntimeError {
    fn from(error: url::ParseError) -> Self {
        Self::Url(error)
    }
}

impl From<matrix_sdk::Error> for MatrixRuntimeError {
    fn from(error: matrix_sdk::Error) -> Self {
        Self::Matrix(error)
    }
}

impl From<std::io::Error> for MatrixRuntimeError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for MatrixRuntimeError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}
