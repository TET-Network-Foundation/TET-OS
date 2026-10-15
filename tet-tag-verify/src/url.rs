//! Reading a SUN URL as the tag writes it. No network: the URL is only text.
//!
//! Parameter names depend on how the tag was set up, so the defaults below follow the common
//! examples (AN12196, sdm-backend): `uid` + `ctr` + `cmac` for plain mirroring, `picc_data` or
//! `e` + `cmac` or `c` for encrypted PICCData.

use crate::sun::{self, Key, SunError, SunResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Mode {
    Plain,
    Encrypted,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UrlError {
    NoQuery,
    Missing(&'static str),
    UnknownParam(String),
    /// The same parameter twice: which one the tag wrote is unclear, so nothing is checked.
    Repeated(String),
    /// The MAC input must start before the MAC; otherwise the data it should cover is unchecked.
    MacInputAfterMac(String),
    Sun(SunError),
}

impl std::fmt::Display for UrlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UrlError::NoQuery => write!(f, "the URL has no query part (nothing after '?')"),
            UrlError::Missing(what) => write!(f, "the URL has no {what}"),
            UrlError::UnknownParam(p) => write!(f, "the URL has no parameter named '{p}'"),
            UrlError::Repeated(p) => write!(f, "the URL has the parameter '{p}' more than once"),
            UrlError::MacInputAfterMac(p) => {
                write!(
                    f,
                    "the parameter '{p}' comes after the MAC, so it can't be where the MAC input starts"
                )
            }
            UrlError::Sun(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for UrlError {}

impl From<SunError> for UrlError {
    fn from(e: SunError) -> Self {
        UrlError::Sun(e)
    }
}

/// One `name=value` pair, with where its value starts and ends in the whole URL.
#[derive(Debug, Clone)]
struct Param<'a> {
    name: &'a str,
    value: &'a str,
    start: usize,
}

fn params(url: &str) -> Result<Vec<Param<'_>>, UrlError> {
    let q = url.find('?').ok_or(UrlError::NoQuery)? + 1;
    let end = url[q..].find('#').map_or(url.len(), |i| q + i);
    let mut out = Vec::new();
    let mut pos = q;
    for part in url[q..end].split('&') {
        if let Some(eq) = part.find('=') {
            out.push(Param {
                name: &part[..eq],
                value: &part[eq + 1..],
                start: pos + eq + 1,
            });
        }
        pos += part.len() + 1;
    }
    for (i, p) in out.iter().enumerate() {
        if out[..i].iter().any(|q| q.name == p.name) {
            return Err(UrlError::Repeated(p.name.to_string()));
        }
    }
    Ok(out)
}

fn find<'a>(ps: &'a [Param<'a>], names: &[&str]) -> Option<&'a Param<'a>> {
    names.iter().find_map(|n| ps.iter().find(|p| p.name == *n))
}

pub struct Checked {
    pub mode: Mode,
    pub result: SunResult,
}

/// Check one SUN URL. `mac_key` defaults to `key` when the tag uses one key for both.
/// `mac_input_from` names the parameter where the tag's MAC input starts (SDMMACInputOffset);
/// without it the MAC input is empty, the usual setup.
pub fn verify_url(
    key: &Key,
    mac_key: Option<&Key>,
    url: &str,
    mac_input_from: Option<&str>,
) -> Result<Checked, UrlError> {
    let ps = params(url)?;
    let mac = find(&ps, &["cmac", "c"]).ok_or(UrlError::Missing("SDMMAC (cmac= or c=)"))?;
    let mac_input: &[u8] = match mac_input_from {
        None => &[],
        Some(name) => {
            let from = ps
                .iter()
                .find(|p| p.name == name)
                .ok_or_else(|| UrlError::UnknownParam(name.to_string()))?;
            // From the start of that value up to the start of the MAC's value.
            if from.start > mac.start {
                return Err(UrlError::MacInputAfterMac(name.to_string()));
            }
            &url.as_bytes()[from.start..mac.start]
        }
    };
    let file_key = mac_key.unwrap_or(key);
    if let Some(e) = find(&ps, &["picc_data", "e"]) {
        let result = sun::verify_encrypted(key, file_key, e.value, mac.value, mac_input)?;
        return Ok(Checked {
            mode: Mode::Encrypted,
            result,
        });
    }
    let uid = find(&ps, &["uid"]).ok_or(UrlError::Missing(
        "encrypted data (picc_data= or e=) or UID (uid=)",
    ))?;
    let ctr = find(&ps, &["ctr"]).ok_or(UrlError::Missing("counter (ctr=)"))?;
    let result = sun::verify_plain(file_key, uid.value, ctr.value, mac.value, mac_input)?;
    Ok(Checked {
        mode: Mode::Plain,
        result,
    })
}
