//! The plain-words result of one check, shared by the CLI's text and JSON output and the README,
//! so they say the same thing (docs/plans/GENUINE_TAG.md §4).

use serde::Serialize;

use crate::docs::tag_id;
use crate::url::{Checked, Mode};

pub const DOES_NOT_SHOW: [&str; 4] = [
    "It does not by itself show the item is genuine. A tag can be removed and moved; this is about the chip, not the object it is on.",
    "It does not show who holds the item. Ownership is a separate record on TET.",
    "A copied link checks the same as the tap that made it. Only a counter that went up since the last tap seen tells a fresh tap from a copy.",
    "This check ran on this computer with the key you gave. TET's chain did not check it.",
];

pub const SHOWS_INVALID: &str =
    "Nothing. The signature doesn't match this key: wrong key, a changed URL, or not this tag.";

pub fn shows_valid(counter: u32) -> String {
    format!("The chip that made this URL knew this key when it was tapped, at counter {counter}.")
}

/// The machine-readable result of `verify --json`.
#[derive(Debug, Clone, Serialize)]
pub struct Report {
    pub valid: bool,
    pub mode: &'static str,
    pub uid: String,
    pub counter: u32,
    /// Whether the counter is above `--last-counter`; null when none was given.
    pub counter_went_up: Option<bool>,
    pub tag_id: String,
    pub mac_input_used: String,
    pub shows: Vec<String>,
    pub does_not_show: Vec<String>,
}

pub fn report(c: &Checked, last_counter: Option<u32>) -> Report {
    let r = &c.result;
    Report {
        valid: r.mac_valid,
        mode: match c.mode {
            Mode::Plain => "plain",
            Mode::Encrypted => "encrypted",
        },
        uid: hex::encode(r.uid),
        counter: r.counter,
        counter_went_up: last_counter.map(|last| r.counter > last),
        tag_id: tag_id(&r.uid),
        mac_input_used: c.mac_input.clone(),
        shows: vec![if r.mac_valid {
            shows_valid(r.counter)
        } else {
            SHOWS_INVALID.to_string()
        }],
        does_not_show: DOES_NOT_SHOW.iter().map(|s| s.to_string()).collect(),
    }
}
