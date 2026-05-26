//! Persistent libp2p identity (`libp2p_keypair.bin`) under the sled DB directory.

use libp2p::PeerId;
use libp2p::identity::Keypair;
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

    pub fn keypair(&self) -> Keypair {
        self.keypair.clone()
    }

    pub fn peer_id(&self) -> PeerId {
        PeerId::from(self.keypair.public())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

/// Log bootnode hints for operators (docker-compose / `TET_BOOTNODES`).
pub fn log_peer_id_banner(peer_id: &PeerId, p2p_listen: &str) {
    let listen = p2p_listen.trim();
    let listen_base = listen.trim_end_matches('/').to_string();
    let full = format!("{listen_base}/p2p/{peer_id}");
    eprintln!("============================================================");
    eprintln!("libp2p PeerId: {peer_id}");
    eprintln!("Full multiaddr (TET_P2P_LISTEN): {full}");
    eprintln!("============================================================");
}
