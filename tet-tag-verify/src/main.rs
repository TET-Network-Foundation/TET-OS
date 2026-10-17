//! tet-tag-verify: check a tap offline, and write or hash the two tag documents.
//!
//! - verify --key <hex> --url <sun-url> [--json]
//! - derive --master <hex> --uid <hex> --aid <hex> --sid <hex>   → the tag's diversified key (AN10922)
//! - doc registration … / doc claim …   → canonical JSON, then its SHA-256
//! - doc hash <file.json>              → SHA-256 of the document's canonical form

use clap::{Parser, Subcommand, ValueEnum};
use std::process::ExitCode;
use tet_tag_verify::diversify::{diversification_input, diversify_aes128};
use tet_tag_verify::docs::{
    CLAIM_KIND, Chip, Product, REGISTRATION_KIND, TagClaimV1, TagRegistrationV1, Tamper, Tap,
    tag_id,
};
use tet_tag_verify::report::report;
use tet_tag_verify::sun::{Key, parse_hex};
use tet_tag_verify::url::verify_url;

#[derive(Parser)]
#[command(
    name = "tet-tag-verify",
    about = "Check an NTAG 424 DNA tap (SUN URL) against a key, and write the tag documents, offline"
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
        /// Print the result as JSON.
        #[arg(long)]
        json: bool,
    },
    /// Derive one tag's AES-128 key from a master key, per NXP AN10922 (prints 32 hex characters).
    Derive {
        /// The master key, 32 hex characters.
        #[arg(long)]
        master: String,
        /// The tag's UID, 7 bytes as hex.
        #[arg(long)]
        uid: String,
        /// The application identifier, 3 bytes as hex.
        #[arg(long)]
        aid: String,
        /// The system identifier as hex, up to 21 bytes (may be empty: --sid "").
        #[arg(long)]
        sid: String,
    },
    /// Write a tag document, or hash one.
    Doc {
        #[command(subcommand)]
        doc: DocCmd,
    },
}

#[derive(Clone, Copy, ValueEnum)]
enum ChipArg {
    #[value(name = "ntag424dna")]
    Ntag424Dna,
    #[value(name = "ntag424dna_tt")]
    Ntag424DnaTt,
}

#[derive(Clone, Copy, ValueEnum)]
enum TamperArg {
    Closed,
    Open,
}

#[derive(Subcommand)]
enum DocCmd {
    /// Print a canonical tet_tag_registration document and its SHA-256.
    Registration {
        /// The tag's UID, 7 bytes as hex (only its hash goes in the document).
        #[arg(long)]
        uid: String,
        #[arg(long, value_enum)]
        chip: ChipArg,
        /// The product's label, as the brand describes it.
        #[arg(long)]
        product: String,
        /// The brand's own reference for the product.
        #[arg(long = "ref", default_value = "")]
        reference: String,
        /// SHA-256 of a product image (repeat for several).
        #[arg(long = "image-sha256")]
        images: Vec<String>,
        /// The brand's SUN verifier, an https:// address.
        #[arg(long)]
        verifier_url: String,
        /// The counter of the tap that registered the tag (required: there is no safe default).
        #[arg(long)]
        counter: u32,
    },
    /// Print a canonical tet_tag_claim document and its SHA-256.
    Claim {
        #[arg(long)]
        uid: String,
        /// SHA-256 of the registration document.
        #[arg(long)]
        registration_sha256: String,
        /// SHA-256 of the previous claim; leave out for the claim on first scan.
        #[arg(long)]
        previous_claim_sha256: Option<String>,
        /// SHA-256 of the current owner's release naming the new owner.
        #[arg(long)]
        release_sha256: Option<String>,
        /// The claimant's ID.
        #[arg(long)]
        new_owner: String,
        /// The counter of the claiming tap.
        #[arg(long)]
        counter: u32,
        /// The tamper loop, on chips that have one.
        #[arg(long, value_enum)]
        tamper: Option<TamperArg>,
        /// SHA-256 of the brand verifier's signed "this tap was valid".
        #[arg(long)]
        attestation_sha256: String,
    },
    /// Print the SHA-256 of a document file's canonical form; exit 1 if it isn't a valid document.
    Hash { file: std::path::PathBuf },
}

fn key(what: &'static str, s: &str) -> Result<Key, String> {
    parse_hex::<16>(what, s).map_err(|e| e.to_string())
}

fn uid(s: &str) -> Result<Vec<u8>, String> {
    parse_hex::<7>("UID", s)
        .map(|u| u.to_vec())
        .map_err(|e| e.to_string())
}

/// Exit code 0 = valid / done, 1 = signature not valid or not a valid document, 2 = bad input.
fn run(cmd: Cmd) -> Result<u8, String> {
    match cmd {
        Cmd::Verify {
            key: k,
            url,
            mac_key,
            mac_input_from,
            last_counter,
            json,
        } => {
            let k = key("key", &k)?;
            let mk = mac_key.as_deref().map(|m| key("MAC key", m)).transpose()?;
            let c = verify_url(&k, mk.as_ref(), &url, mac_input_from.as_deref())
                .map_err(|e| e.to_string())?;
            let r = report(&c, last_counter);
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&r).expect("report serialises")
                );
            } else {
                let mode = if r.mode == "plain" {
                    "UID and counter in plain text"
                } else {
                    "UID and counter encrypted"
                };
                println!("Tap data:   {mode}");
                println!(
                    "Signature:  {}",
                    if r.valid {
                        "VALID for this key"
                    } else {
                        "NOT VALID for this key"
                    }
                );
                println!("Counter:    {}", r.counter);
                match (last_counter, r.counter_went_up) {
                    (Some(last), Some(true)) => println!("Counter went up: yes (last seen {last})"),
                    (Some(last), _) => println!(
                        "Counter went up: NO (last seen {last}); this could be a copied or replayed link"
                    ),
                    (None, _) => println!("Counter went up: not checked (no --last-counter given)"),
                }
                println!(
                    "Tag ID:     {} (SHA-256 of \"tet tag v1\" and the UID)",
                    r.tag_id
                );
                println!("\nWhat this shows");
                for s in &r.shows {
                    println!("- {s}");
                }
                println!("\nWhat this does not show");
                for s in &r.does_not_show {
                    println!("- {s}");
                }
            }
            Ok(if r.valid { 0 } else { 1 })
        }
        Cmd::Derive {
            master,
            uid: u,
            aid,
            sid,
        } => {
            let master = key("master key", &master)?;
            let u = uid(&u)?;
            let aid = parse_hex::<3>("AID", &aid).map_err(|e| e.to_string())?;
            let sid = hex::decode(sid.trim()).map_err(|_| "system identifier is not valid hex".to_string())?;
            let d = diversification_input(&u, &aid, &sid);
            let k = diversify_aes128(&master, &d).map_err(|e| e.to_string())?;
            println!("{}", hex::encode(k));
            Ok(0)
        }
        Cmd::Doc {
            doc:
                DocCmd::Registration {
                    uid: u,
                    chip,
                    product,
                    reference,
                    images,
                    verifier_url,
                    counter,
                },
        } => {
            let d = TagRegistrationV1 {
                v: 1,
                kind: REGISTRATION_KIND.into(),
                tag_id: tag_id(&uid(&u)?),
                chip: match chip {
                    ChipArg::Ntag424Dna => Chip::Ntag424Dna,
                    ChipArg::Ntag424DnaTt => Chip::Ntag424DnaTt,
                },
                product: Product {
                    label: product,
                    reference,
                    images_sha256: images,
                },
                verifier: verifier_url,
                counter_at_registration: counter,
            };
            d.validate().map_err(|e| e.to_string())?;
            println!("{}\n{}", d.canonical_json(), d.sha256());
            Ok(0)
        }
        Cmd::Doc {
            doc:
                DocCmd::Claim {
                    uid: u,
                    registration_sha256,
                    previous_claim_sha256,
                    release_sha256,
                    new_owner,
                    counter,
                    tamper,
                    attestation_sha256,
                },
        } => {
            let d = TagClaimV1 {
                v: 1,
                kind: CLAIM_KIND.into(),
                tag_id: tag_id(&uid(&u)?),
                registration_record_sha256: registration_sha256,
                previous_claim_sha256,
                release_sha256,
                new_owner,
                tap: Tap {
                    counter,
                    tamper: tamper.map(|t| match t {
                        TamperArg::Closed => Tamper::Closed,
                        TamperArg::Open => Tamper::Open,
                    }),
                },
                verifier_attestation_sha256: attestation_sha256,
            };
            d.validate().map_err(|e| e.to_string())?;
            println!("{}\n{}", d.canonical_json(), d.sha256());
            Ok(0)
        }
        Cmd::Doc {
            doc: DocCmd::Hash { file },
        } => {
            let text = std::fs::read_to_string(&file)
                .map_err(|e| format!("can't read {}: {e}", file.display()))?;
            let kind = serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|v| v.get("kind").and_then(|k| k.as_str()).map(str::to_string));
            let hashed = match kind.as_deref() {
                Some(REGISTRATION_KIND) => TagRegistrationV1::from_json(&text).map(|d| d.sha256()),
                Some(CLAIM_KIND) => TagClaimV1::from_json(&text).map(|d| d.sha256()),
                _ => {
                    eprintln!(
                        "not a valid document: no known kind (tet_tag_registration or tet_tag_claim)"
                    );
                    return Ok(1);
                }
            };
            match hashed {
                Ok(h) => {
                    println!("{h}");
                    Ok(0)
                }
                Err(e) => {
                    eprintln!("{e}");
                    Ok(1)
                }
            }
        }
    }
}

fn main() -> ExitCode {
    match run(Cli::parse().cmd) {
        Ok(code) => ExitCode::from(code),
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::from(2)
        }
    }
}
