//! Custom libp2p request/response codec for `/tet/v1/files/fetch` (Phase 0 Step 4, spec §9).
//!
//! `request_response::json::Behaviour`'s built-in codec caps **requests** at 1 MiB and is not
//! size-configurable from outside the crate, so 5 MiB encrypted file bodies need this dedicated
//! codec. Frames are plain JSON (same shape as the json codec) with explicit, asymmetric caps:
//!
//! - request  ([`crate::files::FileFetchRequest`], a UUID) — capped at [`FETCH_REQUEST_MAX_BYTES`];
//! - response ([`crate::files::FileFetchResponse`], base64 blob) — capped at
//!   [`FETCH_RESPONSE_MAX_BYTES`], sized for `MAX_FILE_BODY_BYTES` (5 MiB) after base64
//!   inflation (×4/3 ≈ 6.7 MiB) plus JSON envelope overhead.
//!
//! Wire format note: like the upstream json codec, EOF delimits a frame (the substream is closed
//! after each message), so no length prefix is needed; `take(max)` enforces the cap.

use async_trait::async_trait;
use futures::prelude::*;
use libp2p::StreamProtocol;
use libp2p::request_response;
use std::io;

use super::{FileFetchRequest, FileFetchResponse};

/// Max request frame size (a `FileFetchRequest` is a few dozen bytes; 64 KiB is generous).
pub const FETCH_REQUEST_MAX_BYTES: u64 = 64 * 1024;
/// Max response frame size: 5 MiB blob → ~6.7 MiB base64 + JSON overhead, capped at 8 MiB.
pub const FETCH_RESPONSE_MAX_BYTES: u64 = 8 * 1024 * 1024;

/// Size-configurable JSON codec for the files fetch protocol (see module docs).
#[derive(Debug, Clone, Default)]
pub struct FilesFetchCodec;

#[async_trait]
impl request_response::Codec for FilesFetchCodec {
    type Protocol = StreamProtocol;
    type Request = FileFetchRequest;
    type Response = FileFetchResponse;

    async fn read_request<T>(&mut self, _: &Self::Protocol, io: &mut T) -> io::Result<Self::Request>
    where
        T: AsyncRead + Unpin + Send,
    {
        let mut vec = Vec::new();
        io.take(FETCH_REQUEST_MAX_BYTES).read_to_end(&mut vec).await?;
        Ok(serde_json::from_slice(vec.as_slice())?)
    }

    async fn read_response<T>(
        &mut self,
        _: &Self::Protocol,
        io: &mut T,
    ) -> io::Result<Self::Response>
    where
        T: AsyncRead + Unpin + Send,
    {
        let mut vec = Vec::new();
        io.take(FETCH_RESPONSE_MAX_BYTES)
            .read_to_end(&mut vec)
            .await?;
        Ok(serde_json::from_slice(vec.as_slice())?)
    }

    async fn write_request<T>(
        &mut self,
        _: &Self::Protocol,
        io: &mut T,
        req: Self::Request,
    ) -> io::Result<()>
    where
        T: AsyncWrite + Unpin + Send,
    {
        let data = serde_json::to_vec(&req)?;
        io.write_all(data.as_ref()).await?;
        Ok(())
    }

    async fn write_response<T>(
        &mut self,
        _: &Self::Protocol,
        io: &mut T,
        resp: Self::Response,
    ) -> io::Result<()>
    where
        T: AsyncWrite + Unpin + Send,
    {
        let data = serde_json::to_vec(&resp)?;
        io.write_all(data.as_ref()).await?;
        Ok(())
    }
}
