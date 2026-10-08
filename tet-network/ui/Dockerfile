# syntax=docker/dockerfile:1
#
# Sovereign OS UI image.
#
# BUILD CONTEXT IS THE REPOSITORY ROOT, not this directory:
#
#     docker build -f tet-network/ui/Dockerfile .
#
# because stage 1 builds `tet-pqc-wasm`, which lives in the Rust workspace next
# to this app. The PQC module is baked into the image on purpose: the UI signs
# every ML-DSA-44 message through it, `public/pqc/.gitignore` is `*`, and a
# runtime build would put a Rust toolchain in the runtime image and make first
# boot depend on crates.io being reachable. See docs/RUNNING_A_NODE.md.

# ---- stage 1: post-quantum WASM -------------------------------------------
FROM rust:1.94-bookworm AS pqc

# `methods/` runs risc0-build in its build script; nothing here needs the guests.
ENV RISC0_SKIP_BUILD=1

RUN rustup target add wasm32-unknown-unknown \
 && cargo install wasm-pack --locked

WORKDIR /workspace
COPY . .

# Exactly the command docs/RUNNING_A_NODE.md gives an operator, with an absolute
# out-dir so stage 3 can copy it without knowing the workspace layout.
RUN wasm-pack build tet-pqc-wasm --target web --out-dir /pqc \
 && test -s /pqc/tet_pqc_wasm_bg.wasm \
 && test -s /pqc/tet_pqc_wasm.js

# ---- stage 2: node dependencies -------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY tet-network/ui/package.json tet-network/ui/package-lock.json ./
RUN npm ci

# ---- stage 3: next build ---------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# NEXT_PUBLIC_* is inlined at build time, so these must match the node this
# image will be pointed at. A treasury or founder mismatch changes the computed
# genesis hash and every hybrid-signed request is rejected.
ARG NEXT_PUBLIC_TET_TREASURY_ADDRESS
ARG NEXT_PUBLIC_TET_GENESIS_FOUNDER_WALLET_ID
ARG NEXT_PUBLIC_TET_CHAIN_ID
# The try page's "message the demo" recipient (empty: no such button). Only the demo overlay sets it.
ARG NEXT_PUBLIC_TET_DEMO_CONTACT=""
# The try page's public questions board invite (empty: the page asks for one). Demo overlay only.
ARG NEXT_PUBLIC_TET_QUESTIONS_INVITE=""
# The try page's public-board directory invite (empty: no "Public boards"). Demo overlay only.
ARG NEXT_PUBLIC_TET_DIRECTORY_INVITE=""
ARG NEXT_PUBLIC_TET_SIGNATURES_INVITE=""
# The commit "verify this page" names (empty: the page says the build doesn't name it).
ARG NEXT_PUBLIC_TET_BUILD_SHA=""
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_TET_TREASURY_ADDRESS=${NEXT_PUBLIC_TET_TREASURY_ADDRESS} \
    NEXT_PUBLIC_TET_GENESIS_FOUNDER_WALLET_ID=${NEXT_PUBLIC_TET_GENESIS_FOUNDER_WALLET_ID} \
    NEXT_PUBLIC_TET_CHAIN_ID=${NEXT_PUBLIC_TET_CHAIN_ID} \
    NEXT_PUBLIC_TET_DEMO_CONTACT=${NEXT_PUBLIC_TET_DEMO_CONTACT} \
    NEXT_PUBLIC_TET_QUESTIONS_INVITE=${NEXT_PUBLIC_TET_QUESTIONS_INVITE} \
    NEXT_PUBLIC_TET_DIRECTORY_INVITE=${NEXT_PUBLIC_TET_DIRECTORY_INVITE} \
    NEXT_PUBLIC_TET_SIGNATURES_INVITE=${NEXT_PUBLIC_TET_SIGNATURES_INVITE} \
    NEXT_PUBLIC_TET_BUILD_SHA=${NEXT_PUBLIC_TET_BUILD_SHA}

COPY --from=deps /app/node_modules ./node_modules
COPY tet-network/ui/ ./
COPY --from=pqc /pqc/ ./public/pqc/

RUN npm run build \
 && test -s .next/standalone/server.js \
 && test -s public/pqc/tet_pqc_wasm_bg.wasm

# ---- stage 4: runtime ------------------------------------------------------
# `output: "standalone"` (next.config.ts) traces the exact node_modules the
# server needs, so the runtime image carries no npm install and no dev deps.
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Server-side proxy target (app/tet-node-api/[...path]/route.ts). In compose this
# is the tet-core service DNS name; the browser only ever talks to this origin.
ENV TET_CORE_ORIGIN=http://tet-core:5010

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
