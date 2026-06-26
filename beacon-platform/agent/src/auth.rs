// auth.rs — JWT Authentication

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct LoginRequest {
    username: String,
    password: String,
}

#[derive(Deserialize)]
struct LoginResponse {
    access: String,
}

/// Login to beacon server and get JWT access token
pub async fn login(rest_base_url: &str, username: &str, password: &str) -> Result<String> {
    let login_url = format!("{}/api/v1/auth/login/", rest_base_url.trim_end_matches('/'));

    let client = reqwest::Client::new();
    let response = client
        .post(&login_url)
        .json(&LoginRequest {
            username: username.to_string(),
            password: password.to_string(),
        })
        .send()
        .await
        .map_err(|e| anyhow!("Login request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!("Login failed ({}): {}", status, body));
    }

    let login_response: LoginResponse = response
        .json()
        .await
        .map_err(|e| anyhow!("Failed to parse login response: {}", e))?;

    Ok(login_response.access)
}
