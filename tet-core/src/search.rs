//! TetSearch v1: the listing of signed sites that members can search (docs/plans/TETSEARCH.md).
//!
//! A site is searchable when a **Shelter member** lists it with a record signed by **both** their
//! member wallet and the site's own key: nobody can list a site that isn't theirs, and only vouched
//! people (Shelter's in-person vouch) can publish. "Keys without a human vouch can't publish."
//!
//! The node keeps only the listings. Search itself runs in the member's browser: it reads the
//! listings (members only, Shelter's signed reads), fetches each listed site's signed edit chain
//! (public, `/sites/:id`), renders it with the site language and searches the text locally. So the
//! node never sees what a member searches for. Listings whose member left the set, or whose site
//! has expired, are not served.

use crate::tmail::envelope::TmailHybridSig;
use serde::{Deserialize, Serialize};

pub const LISTING_KIND: &str = "tet search list";
/// How far a listing's time may be from the node's clock (as Tmail envelopes).
pub const LISTING_SKEW_MS: u64 = 5 * 60_000;
/// Listings (new or renewed) one member may make per UTC day.
pub const LISTINGS_PER_MEMBER_PER_DAY: u64 = 5;
const TREE_LISTINGS: &str = "search_listings_v1";
const TREE_DAILY: &str = "search_daily_v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchListingV1 {
    pub v: u32,
    pub kind: String,
    pub site_wallet_id: String,
    pub member_wallet_id: String,
    pub listed_at_ms: u64,
    /// Signed by the member's wallet.
    pub member_sig: TmailHybridSig,
    /// Signed by the site's own key.
    pub site_sig: TmailHybridSig,
}

/// `PAE("tet search list v1", [chain_id, genesis_hash, site, member, listed_at_ms, signer_mldsa_pk])`:
/// the same bytes for both signers but for the signer's own ML-DSA key.
pub fn listing_auth_message_bytes(l: &SearchListingV1, mldsa_pubkey_b64: &str) -> Vec<u8> {
    let chain = crate::genesis::chain_id_from_env();
    let genesis = crate::genesis::expected_genesis_hash_from_env();
    let at = l.listed_at_ms.to_string();
    crate::agent::pae(
        "tet search list v1",
        &[
            chain.as_bytes(),
            genesis.as_bytes(),
            l.site_wallet_id.trim().to_ascii_lowercase().as_bytes(),
            l.member_wallet_id.trim().to_ascii_lowercase().as_bytes(),
            at.as_bytes(),
            mldsa_pubkey_b64.trim().as_bytes(),
        ],
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ListingRefusal {
    Off,
    BadRequest(String),
    ClockOff,
    BadSignature(&'static str),
    NoSuchSite,
    NotAMember,
    DailyCap,
}

impl ListingRefusal {
    pub fn status(&self) -> u16 {
        match self {
            Self::Off | Self::NoSuchSite => 404,
            Self::BadRequest(_) | Self::ClockOff => 400,
            Self::BadSignature(_) => 401,
            Self::NotAMember => 403,
            Self::DailyCap => 429,
        }
    }
    pub fn reason(&self) -> String {
        match self {
            Self::Off => "TetSearch is not open on this node (it needs Shelter)".into(),
            Self::BadRequest(r) => r.clone(),
            // The same words as the node's clock rule for messages (tmail::envelope::check_sent_at).
            Self::ClockOff => "your device clock is off: set it to the right time and try again".into(),
            Self::BadSignature(who) => format!("the {who}'s signature doesn't verify"),
            Self::NoSuchSite => "this node has no such site".into(),
            Self::NotAMember => "only vouched members can publish to TetSearch: keys without a human vouch can't publish".into(),
            Self::DailyCap => format!("that's today's {LISTINGS_PER_MEMBER_PER_DAY} listings; try again tomorrow"),
        }
    }
}

fn is_64hex(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

pub struct SearchStore {
    listings: sled::Tree,
    daily: sled::Tree,
    lock: std::sync::Mutex<()>,
}

impl SearchStore {
    pub fn open(db: &sled::Db) -> Result<Self, sled::Error> {
        Ok(Self { listings: db.open_tree(TREE_LISTINGS)?, daily: db.open_tree(TREE_DAILY)?, lock: std::sync::Mutex::new(()) })
    }

    /// Check and store a listing. `is_member` and `site_exists` are the node's current view.
    pub fn list(
        &self,
        l: &SearchListingV1,
        now_ms: u64,
        is_member: impl Fn(&str) -> bool,
        site_exists: impl Fn(&str) -> bool,
    ) -> Result<(), ListingRefusal> {
        if l.v != 1 || l.kind != LISTING_KIND {
            return Err(ListingRefusal::BadRequest("unsupported listing".into()));
        }
        let site = l.site_wallet_id.trim().to_ascii_lowercase();
        let member = l.member_wallet_id.trim().to_ascii_lowercase();
        if !is_64hex(&site) || !is_64hex(&member) {
            return Err(ListingRefusal::BadRequest("site and member are 64 hex".into()));
        }
        if l.listed_at_ms.abs_diff(now_ms) > LISTING_SKEW_MS {
            return Err(ListingRefusal::ClockOff);
        }
        // Each signature by the key it names, over the listing.
        for (who, sig, wallet) in [("member", &l.member_sig, &member), ("site", &l.site_sig, &site)] {
            if sig.ed25519_pubkey_hex.trim().to_ascii_lowercase() != *wallet {
                return Err(ListingRefusal::BadSignature(who));
            }
            crate::quantum_shield::verify_hybrid(
                wallet,
                Some(&sig.ed25519_sig_b64),
                Some(&sig.mldsa_pubkey_b64),
                Some(&sig.mldsa_sig_b64),
                &listing_auth_message_bytes(l, &sig.mldsa_pubkey_b64),
            )
            .map_err(|_| ListingRefusal::BadSignature(who))?;
        }
        if !site_exists(&site) {
            return Err(ListingRefusal::NoSuchSite);
        }
        if !is_member(&member) {
            return Err(ListingRefusal::NotAMember);
        }
        let _g = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let day = now_ms / 86_400_000;
        let key = format!("{member}|{day}");
        let used = self.daily.get(key.as_bytes()).ok().flatten().and_then(|v| v.as_ref().try_into().ok().map(u64::from_le_bytes)).unwrap_or(0);
        if used >= LISTINGS_PER_MEMBER_PER_DAY {
            return Err(ListingRefusal::DailyCap);
        }
        let stored = SearchListingV1 { site_wallet_id: site.clone(), member_wallet_id: member, ..l.clone() };
        self.listings
            .insert(site.as_bytes(), serde_json::to_vec(&stored).map_err(|e| ListingRefusal::BadRequest(e.to_string()))?)
            .map_err(|e| ListingRefusal::BadRequest(e.to_string()))?;
        let _ = self.daily.insert(key.as_bytes(), &(used + 1).to_le_bytes());
        let _ = self.listings.flush();
        Ok(())
    }

    /// The listings a member may search: their member is still in the set and their site still
    /// exists on this node. Newest listing first.
    pub fn current(&self, is_member: impl Fn(&str) -> bool, site_exists: impl Fn(&str) -> bool) -> Vec<SearchListingV1> {
        let mut out: Vec<SearchListingV1> = self
            .listings
            .iter()
            .filter_map(|r| r.ok())
            .filter_map(|(_, v)| serde_json::from_slice::<SearchListingV1>(&v).ok())
            .filter(|l| is_member(&l.member_wallet_id) && site_exists(&l.site_wallet_id))
            .collect();
        out.sort_by(|a, b| b.listed_at_ms.cmp(&a.listed_at_ms));
        out
    }
}
