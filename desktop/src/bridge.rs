//! The app's HTTP transport, apart from the Tauri window: every request of
//! the Studio, to an engine the app started for a local file or to a
//! Grafeno server, is sent from here (so no server needs to allow the app
//! as a browser origin).

use std::collections::BTreeMap;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_base64: Option<String>,
}

impl Reply {
    fn new(status: u16, headers: BTreeMap<String, String>, bytes: Vec<u8>) -> Self {
        match String::from_utf8(bytes) {
            Ok(body) => Self {
                status,
                headers,
                body,
                body_base64: None,
            },
            Err(error) => Self {
                status,
                headers,
                body: String::new(),
                body_base64: Some(STANDARD.encode(error.as_bytes())),
            },
        }
    }
}

/// The text body stays available to existing callers.
/// A binary body has a single representation: the two are never mixed.
pub fn request_body(body: Option<String>, body_base64: Option<String>) -> Result<Vec<u8>, String> {
    match (body, body_base64) {
        (Some(_), Some(_)) => Err("provide body or bodyBase64, not both".into()),
        (None, Some(encoded)) => STANDARD
            .decode(encoded)
            .map_err(|error| format!("invalid base64 request body: {error}")),
        (body, None) => Ok(body.unwrap_or_default().into_bytes()),
    }
}

/// One request to an engine (blocking): any answer, an error status too,
/// comes back as a [`Reply`]; only a failure to reach it is an error.
pub fn send(
    agent: &ureq::Agent,
    method: &str,
    url: &str,
    headers: &BTreeMap<String, String>,
    body: Vec<u8>,
) -> Result<Reply, String> {
    let mut builder = ureq::http::Request::builder().method(method).uri(url);
    for (name, value) in headers {
        builder = builder.header(name, value);
    }
    let request = builder.body(body).map_err(|error| error.to_string())?;
    let mut response = agent
        .run(request)
        .map_err(|error| format!("cannot reach {url}: {error}"))?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| Some((name.to_string(), value.to_str().ok()?.to_owned())))
        .collect();
    let body = response
        .body_mut()
        .with_config()
        .limit(1 << 30)
        .read_to_vec()
        .map_err(|error| format!("cannot read the response: {error}"))?;
    Ok(Reply::new(status, headers, body))
}

pub fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .build()
        .new_agent()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;

    /// A one-request HTTP server that answers with the request's body.
    fn echo_once() -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = String::new();
            let mut length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
                head.push_str(&line);
                if line == "\r\n" {
                    break;
                }
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let mut stream = stream;
            write!(
                stream,
                "HTTP/1.1 418 I'm a teapot\r\ncontent-type: application/octet-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                body.len()
            )
            .unwrap();
            stream.write_all(&body).unwrap();
            head
        });
        (url, handle)
    }

    fn bytes(reply: &Reply) -> Vec<u8> {
        match &reply.body_base64 {
            Some(body) => STANDARD.decode(body).unwrap(),
            None => reply.body.as_bytes().to_vec(),
        }
    }

    #[test]
    fn binary_bodies_and_error_statuses_come_back_as_they_are() {
        let (url, server) = echo_once();
        let binary: Vec<u8> = (0..=255).collect();
        let headers = BTreeMap::from([("authorization".to_owned(), "Bearer t".to_owned())]);
        let reply = send(
            &agent(),
            "POST",
            &format!("{url}/bytes"),
            &headers,
            binary.clone(),
        )
        .unwrap();
        assert_eq!(reply.status, 418, "errors are answers, not failures");
        assert_eq!(reply.headers["content-type"], "application/octet-stream");
        assert_eq!(bytes(&reply), binary);
        let head = server.join().unwrap();
        assert!(head.starts_with("POST /bytes HTTP/1.1"));
        assert!(
            head.to_ascii_lowercase()
                .contains("authorization: bearer t")
        );
    }

    #[test]
    fn an_unreachable_engine_is_an_error() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/health", listener.local_addr().unwrap());
        drop(listener);
        assert!(send(&agent(), "GET", &url, &BTreeMap::new(), Vec::new()).is_err());
    }

    #[test]
    fn binary_and_text_bodies_have_one_unambiguous_representation() {
        let binary: Vec<u8> = (0..=255).collect();
        let encoded = STANDARD.encode(&binary);
        assert_eq!(request_body(None, Some(encoded.clone())).unwrap(), binary);
        assert!(request_body(Some("text".into()), Some(encoded)).is_err());
        assert!(request_body(None, Some("not base64!".into())).is_err());
        assert_eq!(
            request_body(Some("café".into()), None).unwrap(),
            "café".as_bytes()
        );
        let reply = Reply::new(200, BTreeMap::new(), binary.clone());
        assert_eq!(bytes(&reply), binary);
        let json = serde_json::to_value(&reply).unwrap();
        assert!(json["bodyBase64"].is_string());
        assert_eq!(json["body"], "");
        let text = Reply::new(200, BTreeMap::new(), "café".as_bytes().to_vec());
        assert_eq!(text.body, "café");
        assert!(
            serde_json::to_value(text)
                .unwrap()
                .get("bodyBase64")
                .is_none()
        );
    }
}
