//! tet-tag-verify verify --key <hex> --url <sun-url>
//!
//! Checks one tap offline and says, in plain words, what that does and doesn't show.

use clap::{Parser, Subcommand};
use std::process::ExitCode;
use tet_tag_verify::docs::tag_id;
use tet_tag_verify::sun::{Key, parse_hex};
use tet_tag_verify::url::{Mode, verify_url};

#[derive(Parser)]
#[command(
    name = "tet-tag-verify",
    about = "Check an NTAG 424 DNA tap (SUN URL) against a key, offline"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Check one SUN URL against a 16-byte AES key.
    Verify {
        /// The key, 32 hex characters (used to decrypt PICCData, and for the MAC unless --mac-key is given).
        #[arg(long)]
        key: String,
        /// The URL the tag produced, e.g. "https://example.org/tag?picc_data=…&cmac=…".
        #[arg(long)]
        url: String,
        /// A separate MAC key (K_SDMFileRead), if the tag uses one.
        #[arg(long)]
        mac_key: Option<String>,
        /// The parameter where the tag's MAC input starts (SDMMACInputOffset). Leave out for the usual empty input.
        #[arg(long)]
        mac_input_from: Option<String>,
        /// The highest counter seen for this tag before; tells whether this tap's counter went up.
        #[arg(long)]
        last_counter: Option<u32>,
    },
}

fn key(what: &'static str, s: &str) -> Result<Key, String> {
    parse_hex::<16>(what, s).map_err(|e| e.to_string())
}

fn main() -> ExitCode {
    let Cmd::Verify {
        key: k,
        url,
        mac_key,
        mac_input_from,
        last_counter,
    } = Cli::parse().cmd;
    let run = || -> Result<bool, String> {
        let k = key("key", &k)?;
        let mk = mac_key.as_deref().map(|m| key("MAC key", m)).transpose()?;
        let c = verify_url(&k, mk.as_ref(), &url, mac_input_from.as_deref())
            .map_err(|e| e.to_string())?;
        let r = c.result;
        let mode = match c.mode {
            Mode::Plain => "UID and counter in plain text",
            Mode::Encrypted => "UID and counter encrypted",
        };
        println!("Tap data:   {mode}");
        if r.mac_valid {
            println!("Signature:  VALID for this key");
        } else {
            println!("Signature:  NOT VALID for this key");
        }
        println!("Counter:    {}", r.counter);
        match last_counter {
            Some(last) if r.counter > last => println!("Counter went up: yes (last seen {last})"),
            Some(last) => println!(
                "Counter went up: NO (last seen {last}); this could be a copied or replayed link"
            ),
            None => println!("Counter went up: not checked (no --last-counter given)"),
        }
        println!(
            "Tag ID:     {} (SHA-256 of \"tet tag v1\" and the UID)",
            tag_id(&r.uid)
        );
        println!();
        println!("What this shows");
        if r.mac_valid {
            println!(
                "- The chip that made this URL knew this key when it was tapped, at counter {}.",
                r.counter
            );
        } else {
            println!(
                "- Nothing. The signature doesn't match this key: wrong key, a changed URL, or not this tag."
            );
        }
        println!();
        println!("What this does not show");
        println!(
            "- It does not by itself show the item is genuine. A tag can be removed and moved;"
        );
        println!("  this is about the chip, not the object it is on.");
        println!("- It does not show who holds the item. Ownership is a separate record on TET.");
        println!(
            "- A copied link checks the same as the tap that made it. Only a counter that went up"
        );
        println!("  since the last tap seen tells a fresh tap from a copy.");
        println!(
            "- This check ran on this computer with the key you gave. TET's chain did not check it."
        );
        Ok(r.mac_valid)
    };
    match run() {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::from(1),
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::from(2)
        }
    }
}
