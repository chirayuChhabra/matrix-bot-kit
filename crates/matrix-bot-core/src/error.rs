pub type Result<T> = std::result::Result<T, MatrixBotError>;

#[derive(Debug, PartialEq, Eq)]
pub enum MatrixBotError {
    MissingField { field: &'static str },

    DuplicateCommandGroup { name: String },

    DuplicateListener { name: String },
}

impl std::fmt::Display for MatrixBotError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingField { field } => write!(formatter, "{field} is required"),
            Self::DuplicateCommandGroup { name } => {
                write!(formatter, "a sub-bot named `{name}` is already registered")
            }
            Self::DuplicateListener { name } => {
                write!(formatter, "a listener named `{name}` is already registered")
            }
        }
    }
}

impl std::error::Error for MatrixBotError {}
