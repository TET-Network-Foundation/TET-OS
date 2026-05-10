## Web Wallet (PWA) Stub

Goal: provide a no-install, browser-only entry point for:
- balance checks
- transfers
- API key management (for the B2B gateway)

### Status
This directory is a **stub**. Phase 4 will implement a Next.js/React PWA.

### API (tet-core)
- `GET /ledger/me`
- `POST /ledger/transfer` (`x-api-key` required)
- `GET /ledger/proof` (`x-api-key` required)
- `GET /economics/snapshot` (ESR display)

