use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("unauthorized")]
    Unauthorized,
    #[error("{0}")]
    Forbidden(&'static str),
    #[error("not found")]
    NotFound,
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Conflict(String),
    #[error("internal error")]
    Internal(#[from] anyhow::Error),
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

impl AppError {
    pub fn code(&self) -> StatusCode {
        match self {
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::Forbidden(_) => StatusCode::FORBIDDEN,
            AppError::NotFound => StatusCode::NOT_FOUND,
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::Conflict(_) => StatusCode::CONFLICT,
            AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub fn message(&self) -> String {
        match self {
            AppError::Unauthorized => "unauthorized".into(),
            AppError::Forbidden(msg) => (*msg).into(),
            AppError::NotFound => "not_found".into(),
            AppError::BadRequest(msg) => msg.clone(),
            AppError::Conflict(msg) => msg.clone(),
            AppError::Internal(_) => "internal_error".into(),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        if let AppError::Internal(err) = &self {
            tracing::error!(?err, "internal error");
        }
        let status = self.code();
        let body = Json(ErrorBody {
            error: self.message(),
        });
        (status, body).into_response()
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        AppError::Internal(err.into())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::Internal(err.into())
    }
}

impl From<axum::extract::multipart::MultipartError> for AppError {
    fn from(err: axum::extract::multipart::MultipartError) -> Self {
        if err.status() == StatusCode::PAYLOAD_TOO_LARGE {
            AppError::BadRequest("file too large".into())
        } else {
            AppError::BadRequest(err.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_and_messages() {
        assert_eq!(AppError::Unauthorized.code(), StatusCode::UNAUTHORIZED);
        assert_eq!(AppError::Unauthorized.message(), "unauthorized");
        assert_eq!(
            AppError::Forbidden("must_change_password").code(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(AppError::NotFound.message(), "not_found");
        assert_eq!(AppError::BadRequest("x".into()).message(), "x");
        assert_eq!(AppError::Conflict("y".into()).message(), "y");
        assert_eq!(
            AppError::Internal(anyhow::anyhow!("z")).message(),
            "internal_error"
        );
        let io = AppError::from(std::io::Error::other("e"));
        assert_eq!(io.code(), StatusCode::INTERNAL_SERVER_ERROR);
        let db = AppError::from(rusqlite::Error::InvalidQuery);
        assert_eq!(db.code(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
