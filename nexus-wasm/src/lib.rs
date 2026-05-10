use wasm_bindgen::prelude::*;

// `nexus-wasm` is intended to run in the browser. However, `cargo check --workspace`
// compiles this crate for the host target too. Keep the host build compiling by
// gating wasm-only dependencies and providing no-op stubs.

#[cfg(target_arch = "wasm32")]
use base64::Engine as _;

#[cfg(target_arch = "wasm32")]
const NEXUS_GUEST_ID: [u32; 8] = [
    1782232814, 1005832782, 3430455915, 1904425845, 3360234715, 2739950094, 2779011880, 4022592621,
];

#[wasm_bindgen(start)]
pub fn main_js() -> Result<(), JsValue> {
    console_error_panic_hook::set_once();
    Ok(())
}

#[wasm_bindgen]
pub struct NexusWebClient {
    #[allow(dead_code)]
    base_url: String,
    #[cfg(target_arch = "wasm32")]
    wallet_id: Option<String>,
    #[cfg(target_arch = "wasm32")]
    keypair_proto: Option<Vec<u8>>,
}

#[wasm_bindgen]
impl NexusWebClient {
    #[wasm_bindgen(constructor)]
    pub fn new(base_url: String) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            #[cfg(target_arch = "wasm32")]
            wallet_id: None,
            #[cfg(target_arch = "wasm32")]
            keypair_proto: None,
        }
    }

    #[wasm_bindgen]
    pub fn wallet_id(&self) -> String {
        #[cfg(not(target_arch = "wasm32"))]
        {
            String::new()
        }
        #[cfg(target_arch = "wasm32")]
        {
            self.wallet_id.clone().unwrap_or_default()
        }
    }

    #[wasm_bindgen]
    pub async fn load_identity(&mut self) -> Result<bool, JsValue> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            return Ok(false);
        }

        #[cfg(target_arch = "wasm32")]
        {
            let got = crate::storage::get_identity().await?;
            let Some((wid, kp_bytes)) = got else {
                return Ok(false);
            };
            // Strict financial identity: Ed25519 only, wallet_id must be 64-hex of pubkey.
            use libp2p::identity;
            let kp = identity::Keypair::from_protobuf_encoding(&kp_bytes)
                .map_err(|e| JsValue::from_str(&format!("identity decode failed: {e}")))?;
            let pk = kp
                .public()
                .try_into_ed25519()
                .map_err(|_| JsValue::from_str("identity is not ed25519"))?;
            let derived = hex::encode(pk.to_bytes());
            if wid.trim().to_ascii_lowercase() != derived {
                return Err(JsValue::from_str(
                    "wallet_id does not match ed25519 public key",
                ));
            }
            self.wallet_id = Some(derived);
            self.keypair_proto = Some(kp_bytes);
            Ok(true)
        }
    }

    #[wasm_bindgen]
    pub async fn save_identity(&mut self) -> Result<(), JsValue> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            return Ok(());
        }

        #[cfg(target_arch = "wasm32")]
        {
            // If no identity exists yet, generate one now.
            if self.keypair_proto.is_none()
                || self.wallet_id.as_deref().unwrap_or("").trim().is_empty()
            {
                // Phase 2.2: financial identity is generated via BIP39 mnemonic.
                let phrase = crate::identity::generate_new_mnemonic_12()?;
                let fin = crate::identity::derive_from_mnemonic_12(&phrase)?;
                self.wallet_id = Some(fin.wallet_id_hex);
                self.keypair_proto = Some(fin.keypair_proto);
            }

            let wid = self.wallet_id.clone().unwrap_or_default();
            let kp = self.keypair_proto.clone().unwrap_or_default();
            crate::storage::put_identity(&wid, &kp).await?;
            Ok(())
        }
    }

    #[wasm_bindgen]
    pub async fn generate_new_wallet(&mut self) -> Result<String, JsValue> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            return Err(JsValue::from_str("generate_new_wallet is wasm32-only"));
        }

        #[cfg(target_arch = "wasm32")]
        {
            let phrase = crate::identity::generate_new_mnemonic_12()?;
            let fin = crate::identity::derive_from_mnemonic_12(&phrase)?;
            self.wallet_id = Some(fin.wallet_id_hex.clone());
            self.keypair_proto = Some(fin.keypair_proto.clone());
            crate::storage::put_identity(&fin.wallet_id_hex, &fin.keypair_proto).await?;
            Ok(phrase)
        }
    }

    #[wasm_bindgen]
    pub async fn recover_wallet(&mut self, phrase: String) -> Result<bool, JsValue> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = phrase;
            return Ok(false);
        }

        #[cfg(target_arch = "wasm32")]
        {
            let fin = match crate::identity::derive_from_mnemonic_12(&phrase) {
                Ok(v) => v,
                Err(_) => return Ok(false),
            };
            self.wallet_id = Some(fin.wallet_id_hex.clone());
            self.keypair_proto = Some(fin.keypair_proto.clone());
            crate::storage::put_identity(&fin.wallet_id_hex, &fin.keypair_proto).await?;
            Ok(true)
        }
    }

    #[wasm_bindgen]
    pub async fn connect_to_network(
        &self,
        bootnode_webrtc_addr: String,
    ) -> Result<JsValue, JsValue> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = (bootnode_webrtc_addr,);
            return Err(JsValue::from_str(
                "connect_to_network is only supported in wasm32 (browser) builds.",
            ));
        }

        #[cfg(target_arch = "wasm32")]
        use futures::StreamExt as _;
        #[cfg(target_arch = "wasm32")]
        use libp2p::swarm::{Swarm, SwarmEvent};
        #[cfg(target_arch = "wasm32")]
        use libp2p::{Multiaddr, PeerId, identity, ping};

        #[cfg(target_arch = "wasm32")]
        // Local identity: prefer persisted ed25519 keypair; otherwise generate ephemeral.
        let local_key = if let Some(ref bytes) = self.keypair_proto {
            identity::Keypair::from_protobuf_encoding(bytes)
                .map_err(|e| JsValue::from_str(&format!("bad persisted identity: {e}")))?
        } else {
            identity::Keypair::generate_ed25519()
        };
        #[cfg(target_arch = "wasm32")]
        let peer_id = PeerId::from(local_key.public());

        #[cfg(target_arch = "wasm32")]
        // WebRTC transport for browser (web-sys).
        let transport =
            libp2p_webrtc_websys::Transport::new(libp2p_webrtc_websys::Config::new(&local_key))
                .boxed();

        #[cfg(target_arch = "wasm32")]
        // Minimal behaviour.
        let behaviour = ping::Behaviour::new(ping::Config::new());

        #[cfg(target_arch = "wasm32")]
        let mut swarm = Swarm::new(
            transport,
            behaviour,
            peer_id,
            libp2p::swarm::Config::with_wasm_executor(),
        );

        #[cfg(target_arch = "wasm32")]
        let addr: Multiaddr = bootnode_webrtc_addr
            .parse()
            .map_err(|e| JsValue::from_str(&format!("bad multiaddr: {e}")))?;

        #[cfg(target_arch = "wasm32")]
        swarm
            .dial(addr.clone())
            .map_err(|e| JsValue::from_str(&format!("dial failed: {e}")))?;

        #[cfg(target_arch = "wasm32")]
        web_sys::console::log_1(
            &format!("[wasm][p2p] dialing bootnode addr={addr} local_peer_id={peer_id}").into(),
        );

        #[cfg(target_arch = "wasm32")]
        wasm_bindgen_futures::spawn_local(async move {
            while let Some(ev) = swarm.next().await {
                match ev {
                    SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                        web_sys::console::log_1(
                            &format!("Connected to Nexus Mesh! peer_id={peer_id}").into(),
                        );
                        break;
                    }
                    _ => {}
                }
            }
        });

        #[cfg(target_arch = "wasm32")]
        Ok(JsValue::from_str(
            "Dial initiated; check DevTools console for events.",
        ))
    }

    #[wasm_bindgen]
    pub async fn run_inference(&self, prompt: String) -> Result<String, JsValue> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = (prompt,);
            return Err(JsValue::from_str(
                "run_inference is only supported in wasm32 (browser) builds.",
            ));
        }

        #[cfg(target_arch = "wasm32")]
        // Trigger inference via the UI's origin (no hard-coded host),
        // and receive the response + receipt directly (no polling).
        //
        // This keeps the browser "trustless": verification happens locally in Wasm.
        #[cfg(target_arch = "wasm32")]
        let window = web_sys::window().ok_or_else(|| JsValue::from_str("no window"))?;
        #[cfg(target_arch = "wasm32")]
        let url = format!("{}/api/v1/ai/utility", self.base_url);

        // 1) Fire request (best-effort). We don't rely on its response.
        #[cfg(target_arch = "wasm32")]
        let init = web_sys::RequestInit::new();
        #[cfg(target_arch = "wasm32")]
        init.set_method("POST");
        #[cfg(target_arch = "wasm32")]
        init.set_mode(web_sys::RequestMode::Cors);
        #[cfg(target_arch = "wasm32")]
        let body = serde_json::json!({
            "prompt": prompt,
            "target_worker_id": "nexus_worker_01",
        });
        #[cfg(target_arch = "wasm32")]
        init.set_body(&JsValue::from_str(
            &serde_json::to_string(&body).map_err(|e| JsValue::from_str(&e.to_string()))?,
        ));
        #[cfg(target_arch = "wasm32")]
        let req = web_sys::Request::new_with_str_and_init(&url, &init)
            .map_err(|_| JsValue::from_str("failed to build request"))?;
        #[cfg(target_arch = "wasm32")]
        req.headers()
            .set("Content-Type", "application/json")
            .map_err(|_| JsValue::from_str("failed to set header"))?;

        #[cfg(target_arch = "wasm32")]
        let _ = wasm_bindgen_futures::JsFuture::from(window.fetch_with_request(&req)).await;

        #[cfg(target_arch = "wasm32")]
        web_sys::console::log_1(&"[zk] Verifying RISC Zero receipt in browser...".into());

        // 2) Await response directly.
        #[cfg(target_arch = "wasm32")]
        let resp_js = wasm_bindgen_futures::JsFuture::from(window.fetch_with_request(&req)).await?;
        #[cfg(target_arch = "wasm32")]
        let resp: web_sys::Response = resp_js
            .dyn_into()
            .map_err(|_| JsValue::from_str("bad response"))?;
        #[cfg(target_arch = "wasm32")]
        let txt = wasm_bindgen_futures::JsFuture::from(resp.text()?).await?;
        #[cfg(target_arch = "wasm32")]
        let txt = txt.as_string().unwrap_or_default();

        #[cfg(target_arch = "wasm32")]
        #[derive(serde::Deserialize)]
        struct R {
            response: String,
            receipt_b64: String,
        }
        #[cfg(target_arch = "wasm32")]
        let r: R = serde_json::from_str(&txt)
            .map_err(|e| JsValue::from_str(&format!("bad utility response json: {e}")))?;

        // 3) Verify receipt.
        #[cfg(target_arch = "wasm32")]
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(r.receipt_b64.as_bytes())
            .map_err(|e| JsValue::from_str(&format!("receipt b64 decode failed: {e}")))?;
        #[cfg(target_arch = "wasm32")]
        let receipt: risc0_zkvm::Receipt = bincode::deserialize(&bytes)
            .map_err(|e| JsValue::from_str(&format!("receipt deserialize failed: {e}")))?;
        #[cfg(target_arch = "wasm32")]
        receipt
            .verify(NEXUS_GUEST_ID)
            .map_err(|e| JsValue::from_str(&format!("ZK VERIFICATION FAILED: {e:?}")))?;

        #[cfg(target_arch = "wasm32")]
        Ok(r.response)
    }
}

#[cfg(target_arch = "wasm32")]
mod storage;

#[cfg(target_arch = "wasm32")]
mod identity;
