//! Persistent libp2p identity (`libp2p_keypair.bin`) under the sled DB directory, and the
//! per-plane identities derived from it (`PHASE_1_GENESIS_SPEC.md` §2.4).
//!
//! The node runs three `Swarm`s. Each gets its own Ed25519 identity,
//! `HKDF-SHA256(ikm = root secret, info = "tet/plane/<plane>")`, so the three are distinct on the
//! wire: a dial aimed at the wrong plane reaches a different `PeerId` and is an ordinary first
//! connection, never a second connection to a peer some other `Behaviour` already holds. The root
//! key itself is never handed to a swarm.

use hkdf::Hkdf;
use libp2p::PeerId;
use libp2p::identity::Keypair;
use sha2::Sha256;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub struct P2pKeystore {
    keypair: Keypair,
    path: PathBuf,
}

impl P2pKeystore {
    /// Load or create `libp2p_keypair.bin` under `db_dir`.
    pub fn load_or_create(db_dir: impl AsRef<Path>) -> Result<Self, io::Error> {
        let db_dir = db_dir.as_ref();
        let path = db_dir.join("libp2p_keypair.bin");

        if path.is_file() {
            let bytes = fs::read(&path)?;
            let keypair = Keypair::from_protobuf_encoding(&bytes).map_err(|e| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("libp2p keypair decode failed: {e}"),
                )
            })?;
            log::info!("libp2p keypair loaded from {}", path.display());
            return Ok(Self { keypair, path });
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let keypair = Keypair::generate_ed25519();
        let bytes = keypair
            .to_protobuf_encoding()
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
        fs::write(&path, &bytes)?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&path)?.permissions();
            perms.set_mode(0o600);
            fs::set_permissions(&path, perms)?;
        }

        log::info!("libp2p keypair generated and saved to {}", path.display());
        Ok(Self { keypair, path })
    }

    /// The root identity. Not a wire identity: swarms take [`PlaneKeys`], never this.
    #[cfg(test)]
    pub fn keypair(&self) -> Keypair {
        self.keypair.clone()
    }

    /// The root identity's `PeerId`. No swarm listens under it.
    #[cfg(test)]
    pub fn peer_id(&self) -> PeerId {
        PeerId::from(self.keypair.public())
    }

    /// The three per-plane identities derived from the root secret.
    pub fn plane_keys(&self) -> Result<PlaneKeys, io::Error> {
        PlaneKeys::derive(&self.keypair)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

/// One of the node's three libp2p swarms.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Plane {
    /// `p2p.rs`, `TET_P2P_LISTEN` (8002): blocks, txs, chain sync, Tmail, Files.
    Block,
    /// `p2p_network.rs`, `TET_NEXUS_P2P_LISTEN` (4003): inference.
    Nexus,
    /// `network.rs`, `TET_LEDGER_P2P_LISTEN` (4005): ledger replication.
    Ledger,
}

impl Plane {
    pub const ALL: [Plane; 3] = [Plane::Block, Plane::Nexus, Plane::Ledger];

    /// HKDF `info` label. Changing one changes that plane's `PeerId` on every node.
    pub fn hkdf_info(self) -> &'static str {
        match self {
            Plane::Block => "tet/plane/block",
            Plane::Nexus => "tet/plane/nexus",
            Plane::Ledger => "tet/plane/ledger",
        }
    }
}

/// Ed25519 seed for `plane`: `HKDF-SHA256(salt = none, ikm = root_secret, info = plane label)`.
pub fn plane_seed(root_secret: &[u8; 32], plane: Plane) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(None, root_secret);
    let mut okm = [0u8; 32];
    hk.expand(plane.hkdf_info().as_bytes(), &mut okm)
        .expect("32 bytes is a valid HKDF-SHA256 output length");
    okm
}

/// The per-plane identities. Each swarm constructor takes this and selects its own plane, so a
/// caller cannot hand one plane another plane's key.
#[derive(Clone)]
pub struct PlaneKeys {
    block: Keypair,
    nexus: Keypair,
    ledger: Keypair,
}

impl PlaneKeys {
    /// Derive from the root identity. The root must be Ed25519, which is what
    /// [`P2pKeystore::load_or_create`] generates; any other type is refused rather than guessed at.
    pub fn derive(root: &Keypair) -> Result<Self, io::Error> {
        let ed = root.clone().try_into_ed25519().map_err(|e| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("libp2p root key is not Ed25519, cannot derive plane keys: {e}"),
            )
        })?;
        let mut root_secret = [0u8; 32];
        root_secret.copy_from_slice(ed.secret().as_ref());
        let one = |plane| {
            let mut seed = plane_seed(&root_secret, plane);
            Keypair::ed25519_from_bytes(&mut seed).map_err(|e| {
                io::Error::new(io::ErrorKind::InvalidData, format!("plane key {plane:?}: {e}"))
            })
        };
        Ok(Self {
            block: one(Plane::Block)?,
            nexus: one(Plane::Nexus)?,
            ledger: one(Plane::Ledger)?,
        })
    }

    pub fn keypair(&self, plane: Plane) -> Keypair {
        match plane {
            Plane::Block => self.block.clone(),
            Plane::Nexus => self.nexus.clone(),
            Plane::Ledger => self.ledger.clone(),
        }
    }

    pub fn peer_id(&self, plane: Plane) -> PeerId {
        PeerId::from(self.keypair(plane).public())
    }
}

/// Log bootnode hints for operators (docker-compose / `TET_BOOTNODES`).
///
/// The `libp2p PeerId:` line is the **block plane's**, the one `TET_BOOTNODES` and
/// `TET_PRODUCER_PEERS` name; `scripts/print-bootnode.sh` and `deploy/provision-seed.sh` grep it.
pub fn log_peer_id_banner(keys: &PlaneKeys, p2p_listen: &str) {
    let block = keys.peer_id(Plane::Block);
    let listen = p2p_listen.trim();
    let listen_base = listen.trim_end_matches('/').to_string();
    let full = format!("{listen_base}/p2p/{block}");
    eprintln!("============================================================");
    eprintln!("libp2p PeerId: {block}");
    eprintln!("Full multiaddr (TET_P2P_LISTEN): {full}");
    eprintln!("Nexus plane PeerId (TET_NEXUS_P2P_LISTEN): {}", keys.peer_id(Plane::Nexus));
    eprintln!("Ledger plane PeerId (TET_LEDGER_P2P_LISTEN): {}", keys.peer_id(Plane::Ledger));
    eprintln!("============================================================");
}
