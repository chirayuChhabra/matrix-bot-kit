pub type Result<T> = std::result::Result<T, MatrixBotError>;

#[derive(Debug, PartialEq, Eq)]
pub enum MatrixBotError {
    MissingField { field: &'static str },

    DuplicateSubBot { name: String },

    DuplicateAjent { name: String },
}

impl std::fmt::Display for MatrixBotError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingField { field } => write!(formatter, "{field} is required"),
            Self::DuplicateSubBot { name } => {
                write!(formatter, "a sub-bot named `{name}` is already registered")
            }
            Self::DuplicateAjent { name } => {
                write!(formatter, "an ajent named `{name}` is already registered")
            }
        }
    }
}

impl std::error::Error for MatrixBotError {}
