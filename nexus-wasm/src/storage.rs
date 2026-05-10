#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
use futures::FutureExt as _;

#[cfg(target_arch = "wasm32")]
use std::{cell::RefCell, rc::Rc};

#[cfg(target_arch = "wasm32")]
use futures::channel::oneshot;

#[cfg(target_arch = "wasm32")]
use base64::Engine as _;

#[cfg(target_arch = "wasm32")]
const DB_NAME: &str = "nexus_identity_db";

#[cfg(target_arch = "wasm32")]
const STORE_NAME: &str = "identity";

#[cfg(target_arch = "wasm32")]
const RECORD_KEY: &str = "v1";

#[cfg(target_arch = "wasm32")]
fn idb() -> Result<web_sys::IdbFactory, JsValue> {
    let w = web_sys::window().ok_or_else(|| JsValue::from_str("no window"))?;
    w.indexed_db()?
        .ok_or_else(|| JsValue::from_str("IndexedDB not available"))
}

#[cfg(target_arch = "wasm32")]
async fn open_db() -> Result<web_sys::IdbDatabase, JsValue> {
    let factory = idb()?;
    let req: web_sys::IdbOpenDbRequest = factory
        .open_with_u32(DB_NAME, 1)
        .map_err(|_| JsValue::from_str("indexedDB.open failed"))?;

    // Create store on upgrade.
    let on_upgrade = Closure::<dyn FnMut(web_sys::IdbVersionChangeEvent)>::new(
        move |ev: web_sys::IdbVersionChangeEvent| {
            let Some(target) = ev.target() else { return };
            let Ok(req) = target.dyn_into::<web_sys::IdbOpenDbRequest>() else {
                return;
            };
            let Ok(db_js) = req.result() else { return };
            let Ok(db) = db_js.dyn_into::<web_sys::IdbDatabase>() else {
                return;
            };
            let _ = db.create_object_store(STORE_NAME);
        },
    );
    req.set_onupgradeneeded(Some(on_upgrade.as_ref().unchecked_ref()));
    on_upgrade.forget();

    // Await onsuccess / onerror.
    let (tx, rx) = oneshot::channel::<Result<web_sys::IdbDatabase, JsValue>>();
    let tx = Rc::new(RefCell::new(Some(tx)));
    let tx_ok = tx.clone();
    let req_ok = req.clone();

    let on_success = Closure::<dyn FnMut(web_sys::Event)>::new(move |_ev| {
        let Some(tx) = tx_ok.borrow_mut().take() else {
            return;
        };
        let Ok(db_js) = req_ok.result() else {
            let _ = tx.send(Err(JsValue::from_str("indexedDB open result failed")));
            return;
        };
        let Ok(db) = db_js.dyn_into::<web_sys::IdbDatabase>() else {
            let _ = tx.send(Err(JsValue::from_str("bad IdbDatabase")));
            return;
        };
        let _ = tx.send(Ok(db));
    });
    req.set_onsuccess(Some(on_success.as_ref().unchecked_ref()));
    on_success.forget();

    let (txe, rxe) = oneshot::channel::<Result<web_sys::IdbDatabase, JsValue>>();
    let txe = Rc::new(RefCell::new(Some(txe)));
    let txe_err = txe.clone();
    let on_error = Closure::<dyn FnMut(web_sys::Event)>::new(move |_ev| {
        let Some(tx) = txe_err.borrow_mut().take() else {
            return;
        };
        let _ = tx.send(Err(JsValue::from_str("indexedDB open error")));
    });
    req.set_onerror(Some(on_error.as_ref().unchecked_ref()));
    on_error.forget();

    // Race: whichever fires first.
    futures::select! {
        r = rx.fuse() => r.unwrap_or_else(|_| Err(JsValue::from_str("open_db cancelled"))),
        r = rxe.fuse() => r.unwrap_or_else(|_| Err(JsValue::from_str("open_db cancelled"))),
    }
}

#[cfg(target_arch = "wasm32")]
#[derive(serde::Serialize, serde::Deserialize)]
struct IdentityRecordV1 {
    wallet_id: String,
    keypair_proto_b64: String,
}

#[cfg(target_arch = "wasm32")]
pub async fn put_identity(wallet_id: &str, keypair_proto: &[u8]) -> Result<(), JsValue> {
    let db = open_db().await?;
    let tx = db
        .transaction_with_str_and_mode(STORE_NAME, web_sys::IdbTransactionMode::Readwrite)
        .map_err(|_| JsValue::from_str("idb transaction failed"))?;
    let store = tx
        .object_store(STORE_NAME)
        .map_err(|_| JsValue::from_str("idb object_store failed"))?;

    let rec = IdentityRecordV1 {
        wallet_id: wallet_id.trim().to_string(),
        keypair_proto_b64: base64::engine::general_purpose::STANDARD.encode(keypair_proto),
    };
    let js = JsValue::from_str(
        &serde_json::to_string(&rec).map_err(|e| JsValue::from_str(&e.to_string()))?,
    );

    // Store as JSON string under fixed key.
    let _ = store
        .put_with_key(&js, &JsValue::from_str(RECORD_KEY))
        .map_err(|_| JsValue::from_str("idb put failed"))?;

    let (done_tx, done_rx) = oneshot::channel::<Result<(), JsValue>>();
    let done_tx = Rc::new(RefCell::new(Some(done_tx)));
    let done_tx2 = done_tx.clone();
    let on_complete = Closure::<dyn FnMut(web_sys::Event)>::new(move |_ev| {
        let Some(tx) = done_tx2.borrow_mut().take() else {
            return;
        };
        let _ = tx.send(Ok(()));
    });
    tx.set_oncomplete(Some(on_complete.as_ref().unchecked_ref()));
    on_complete.forget();

    let (err_tx, err_rx) = oneshot::channel::<Result<(), JsValue>>();
    let err_tx = Rc::new(RefCell::new(Some(err_tx)));
    let err_tx2 = err_tx.clone();
    let on_error = Closure::<dyn FnMut(web_sys::Event)>::new(move |_ev| {
        let Some(tx) = err_tx2.borrow_mut().take() else {
            return;
        };
        let _ = tx.send(Err(JsValue::from_str("idb tx error")));
    });
    tx.set_onerror(Some(on_error.as_ref().unchecked_ref()));
    on_error.forget();

    futures::select! {
        r = done_rx.fuse() => r.unwrap_or_else(|_| Err(JsValue::from_str("idb complete cancelled"))),
        r = err_rx.fuse() => r.unwrap_or_else(|_| Err(JsValue::from_str("idb error cancelled"))),
    }
}

#[cfg(target_arch = "wasm32")]
pub async fn get_identity() -> Result<Option<(String, Vec<u8>)>, JsValue> {
    let db = open_db().await?;
    let tx = db
        .transaction_with_str_and_mode(STORE_NAME, web_sys::IdbTransactionMode::Readonly)
        .map_err(|_| JsValue::from_str("idb transaction failed"))?;
    let store = tx
        .object_store(STORE_NAME)
        .map_err(|_| JsValue::from_str("idb object_store failed"))?;

    let req = store
        .get(&JsValue::from_str(RECORD_KEY))
        .map_err(|_| JsValue::from_str("idb get failed"))?;
    let (tx, rx) = oneshot::channel::<Result<JsValue, JsValue>>();
    let tx = Rc::new(RefCell::new(Some(tx)));
    let tx2 = tx.clone();
    let req_ok = req.clone();
    let on_success = Closure::<dyn FnMut(web_sys::Event)>::new(move |_ev| {
        let Some(tx) = tx2.borrow_mut().take() else {
            return;
        };
        let v = req_ok.result().unwrap_or(JsValue::UNDEFINED);
        let _ = tx.send(Ok(v));
    });
    req.set_onsuccess(Some(on_success.as_ref().unchecked_ref()));
    on_success.forget();
    let (txe, rxe) = oneshot::channel::<Result<JsValue, JsValue>>();
    let txe = Rc::new(RefCell::new(Some(txe)));
    let txe2 = txe.clone();
    let on_error = Closure::<dyn FnMut(web_sys::Event)>::new(move |_ev| {
        let Some(tx) = txe2.borrow_mut().take() else {
            return;
        };
        let _ = tx.send(Err(JsValue::from_str("idb get error")));
    });
    req.set_onerror(Some(on_error.as_ref().unchecked_ref()));
    on_error.forget();

    let v = futures::select! {
        r = rx.fuse() => r.unwrap_or_else(|_| Err(JsValue::from_str("idb get cancelled")))?,
        r = rxe.fuse() => r.unwrap_or_else(|_| Err(JsValue::from_str("idb get cancelled")))?,
    };
    if v.is_undefined() || v.is_null() {
        return Ok(None);
    }
    let s = v.as_string().unwrap_or_default();
    if s.trim().is_empty() {
        return Ok(None);
    }
    let rec: IdentityRecordV1 = serde_json::from_str(&s)
        .map_err(|e| JsValue::from_str(&format!("bad identity json: {e}")))?;
    let kp = base64::engine::general_purpose::STANDARD
        .decode(rec.keypair_proto_b64.as_bytes())
        .map_err(|e| JsValue::from_str(&format!("bad keypair b64: {e}")))?;
    Ok(Some((rec.wallet_id, kp)))
}
