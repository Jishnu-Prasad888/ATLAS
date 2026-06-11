// auth.rs — JWT Authentication

use anyhow::{Result, anyhow};
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
pub async fn login(server_addr: &str, username: &str, password: &str) -> Result<String> {
    let base_url = extract_base_url(server_addr)?;
    let login_url = format!("{}/api/v1/auth/login/", base_url);
    
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

/// Extract HTTP base URL from WebSocket URL
/// ws://localhost:8000/ws/ingest/ -> http://localhost:8000
/// wss://example.com/ws/ingest/ -> https://example.com
fn extract_base_url(ws_url: &str) -> Result<String> {
    let url = url::Url::parse(ws_url)
        .map_err(|e| anyhow!("Invalid URL: {}", e))?;
    
    let scheme = match url.scheme() {
        "ws" => "http",
        "wss" => "https",
        _ => return Err(anyhow!("Invalid WebSocket scheme: {}", url.scheme())),
    };
    
    let host = url.host_str()
        .ok_or_else(|| anyhow!("No host in URL"))?;
    
    let port = url.port()
        .map(|p| format!(":{}", p))
        .unwrap_or_default();
    
    Ok(format!("{}://{}{}", scheme, host, port))
}
