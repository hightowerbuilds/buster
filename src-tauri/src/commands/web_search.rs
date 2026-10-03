//! Bounded public web search. Keys stay in the native credential store.
use serde::{Deserialize, Serialize};
use std::time::Duration;

const SERVICE: &str = "com.lukehightower.buster.web-search";

#[cfg(target_os = "linux")]
async fn key() -> Result<String, String> { crate::credentials::lookup(SERVICE, "brave").await }
#[cfg(target_os = "macos")]
async fn key() -> Result<String, String> {
    match security_framework::passwords::get_generic_password(SERVICE, "brave") {
        Ok(bytes) => String::from_utf8(bytes).map_err(|_| "Invalid saved search key".into()),
        Err(e) if e.code() == -25300 => Ok(String::new()),
        Err(_) => Err("Could not read the search key from Keychain".into()),
    }
}
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
async fn key() -> Result<String, String> { Err("Secure search key storage is unavailable on this platform".into()) }

#[tauri::command]
pub async fn web_search_configured() -> Result<bool, String> { Ok(!key().await?.is_empty()) }

#[tauri::command]
pub async fn web_search_save_key(api_key: String) -> Result<(), String> {
    let value = api_key.trim();
    if value.is_empty() || value.len() > 4096 || !value.bytes().all(|b| b.is_ascii_graphic()) {
        return Err("Enter a valid Brave Search API key.".into());
    }
    #[cfg(target_os = "linux")]
    { crate::credentials::store(SERVICE, "brave", value).await }
    #[cfg(target_os = "macos")]
    { security_framework::passwords::set_generic_password(SERVICE, "brave", value.as_bytes()).map_err(|_| "Could not save the search key to Keychain".into()) }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    { Err("Secure search key storage is unavailable on this platform".into()) }
}

#[derive(Debug, Serialize)]
pub struct SearchResult { title: String, url: String, snippet: String }
#[derive(Debug, Serialize)]
pub struct SearchResponse { query: String, provider: &'static str, results: Vec<SearchResult> }
#[derive(Deserialize)]
struct BraveResponse { #[serde(default)] web: Option<BraveWeb>, #[serde(rename = "type")] kind: String }
#[derive(Deserialize)]
struct BraveWeb { results: Vec<BraveResult> }
#[derive(Deserialize)]
struct BraveResult { title: String, url: String, #[serde(default)] description: String }

fn validate(query: &str, count: u8) -> Result<&str, String> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 500 || query.chars().any(char::is_control) || query.split_whitespace().count() > 75 {
        return Err("Use a single-line query of 1–500 characters and at most 75 words.".into());
    }
    if !(1..=10).contains(&count) { return Err("Search count must be from 1 to 10.".into()); }
    Ok(query)
}

fn parse(bytes: &[u8], count: u8) -> Result<Vec<SearchResult>, String> {
    let response: BraveResponse = serde_json::from_slice(bytes).map_err(|_| "Search returned an invalid response.")?;
    if response.kind != "search" { return Err("Search returned an unexpected response.".into()); }
    let mut seen = std::collections::HashSet::new();
    Ok(response.web.map(|web| web.results).unwrap_or_default().into_iter().filter_map(|r| {
        let url = url::Url::parse(&r.url).ok()?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() || !seen.insert(url.to_string()) { return None; }
        Some(SearchResult { title: r.title.chars().take(300).collect(), url: url.to_string(), snippet: r.description.chars().take(1500).collect() })
    }).take(count as usize).collect())
}

async fn fetch(client: &reqwest::Client, endpoint: &str, api_key: &str, query: &str, count: u8) -> Result<Vec<SearchResult>, String> {
    let mut token = reqwest::header::HeaderValue::from_str(api_key).map_err(|_| "The saved search key is invalid.")?;
    token.set_sensitive(true);
    let mut response = client.get(endpoint).header("X-Subscription-Token", token)
        .query(&[("q", query), ("count", &count.to_string()), ("text_decorations", "false"), ("result_filter", "web")])
        .send().await.map_err(|_| "Could not reach web search. Check your connection and try again.")?;
    match response.status().as_u16() {
        200 => (),
        401 | 403 => return Err("Brave rejected the search key. Check the key and subscription in AI Settings.".into()),
        429 => return Err("Brave search quota or rate limit reached. Try again later.".into()),
        _ => return Err(format!("Web search returned HTTP {}. Try again later.", response.status().as_u16())),
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Web search response was interrupted.")? {
        if bytes.len() + chunk.len() > 1_048_576 { return Err("Web search response exceeded the size limit.".into()); }
        bytes.extend_from_slice(&chunk);
    }
    parse(&bytes, count)
}

#[tauri::command]
pub async fn web_search(query: String, count: Option<u8>) -> Result<SearchResponse, String> {
    let count = count.unwrap_or(5);
    let query = validate(&query, count)?;
    let api_key = key().await?;
    if api_key.is_empty() { return Err("Web search needs a Brave Search API key. Add it in AI Settings → Web search.".into()); }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(20)).connect_timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none()).build().map_err(|_| "Could not initialize web search.")?;
    let results = fetch(&client, "https://api.search.brave.com/res/v1/web/search", &api_key, query, count).await?;
    Ok(SearchResponse { query: query.into(), provider: "Brave Search", results })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_queries_and_counts() {
        assert_eq!(validate("  café  ", 5).unwrap(), "café");
        for q in ["".into(), "a\nb".into(), "a".repeat(501), "a ".repeat(76)] { assert!(validate(&q, 5).is_err()); }
        assert!(validate("a", 0).is_err()); assert!(validate("a", 11).is_err());
    }
    #[test]
    fn parses_sources_limits_and_filters_unsafe_links() {
        let data = br#"{"type":"search","web":{"results":[{"title":"Bad","url":"javascript:alert(1)"},{"title":"Good","url":"https://example.com","description":"Source"},{"title":"Duplicate","url":"https://example.com/"},{"title":"Other","url":"https://example.org"}]}}"#;
        let results = parse(data, 5).unwrap();
        assert_eq!(results.len(), 2); assert_eq!(results[0].snippet, "Source");
        assert_eq!(parse(data, 1).unwrap().len(), 1);
        assert!(parse(br#"{"type":"search"}"#, 5).unwrap().is_empty());
        for body in ["{}", "null", "<html>captcha</html>", r#"{"type":"Error"}"#] { assert!(parse(body.as_bytes(), 5).is_err()); }
    }
    #[tokio::test]
    async fn request_authentication_and_http_errors() {
        use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpListener};
        for (status, body, expected) in [
            (200, r#"{"type":"search","web":{"results":[{"title":"Source","url":"https://example.com/","description":"Evidence"}]}}"#, ""),
            (401, "secret-provider-error", "rejected"),
            (429, "secret-provider-error", "rate limit"),
            (503, "secret-provider-error", "HTTP 503"),
            (200, "bad json", "invalid response"),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let endpoint = format!("http://{}/search", listener.local_addr().unwrap());
            let server = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = vec![];
                loop {
                    let mut bytes = [0; 1024];
                    let n = stream.read(&mut bytes).await.unwrap();
                    if n == 0 { break; }
                    request.extend_from_slice(&bytes[..n]);
                    if request.windows(4).any(|w| w == b"\r\n\r\n") { break; }
                }
                let request = String::from_utf8(request).unwrap();
                assert!(request.contains("q=caf%C3%A9+%26+writing"));
                assert!(request.contains("x-subscription-token: test-key"));
                assert!(!request.lines().next().unwrap().contains("test-key"));
                stream.write_all(format!("HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            });
            let client = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(3)).build().unwrap();
            let result = fetch(&client, &endpoint, "test-key", "café & writing", 5).await;
            if expected.is_empty() { assert_eq!(result.unwrap()[0].snippet, "Evidence"); }
            else { let error = result.unwrap_err(); assert!(error.contains(expected), "{error}"); assert!(!error.contains("secret-provider-error")); }
            server.await.unwrap();
        }
    }

}
