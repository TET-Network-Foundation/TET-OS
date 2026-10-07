# Pinned to the toolchain the test suite runs on. The workspace is
# `edition = "2024"` (needs >= 1.85) and the pin was 1.86, close enough to the
# floor that any dependency bump breaks the image; 1.94 removes that trap.
FROM rust:1.94-bookworm AS build
WORKDIR /workspace

ARG RISC0_SKIP_BUILD=0
ARG TET_BUILD_FEATURES=zk-prove
ENV RISC0_SKIP_BUILD=${RISC0_SKIP_BUILD}

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    clang \
    curl \
    pkg-config \
    protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

# RISC Zero toolchain, for the zk-prove build only.
#
# This used to run `cargo binstall cargo-risczero` + `cargo risczero install`.
# RISC Zero removed that path in favour of `rzup`, so the step failed with
#   Error: Run `rzup install` instead
# after about seven seconds, which meant the production image (the compose
# default, RISC0_SKIP_BUILD=0) could not be built at all. Nothing caught it
# because every CI job passes RISC0_SKIP_BUILD=1 — see .github/workflows/zk-image.yml,
# which builds this path on demand so it cannot rot again unnoticed.
# x86_64 ONLY. rzup has no linux/aarch64 build and exits with
#   ✗ Unsupported architecture: linux/aarch64
# so this image cannot be built natively on an Apple Silicon Mac. Use
# `--platform linux/amd64` (slow, emulated) or the zk-image workflow. The seed
# and GitHub runners are both x86_64, where the install was verified on
# 2026-09-22: cargo-risczero 3.0.6, cpp 2024.1.5, r0vm 3.0.6, rust 1.97.0.
ENV PATH="/root/.risc0/bin:${PATH}"
RUN if [ "$RISC0_SKIP_BUILD" != "1" ]; then \
      curl -L https://risczero.com/install | bash && \
      rzup install; \
    fi

COPY . .
# The source commit, compiled in for `GET /status/live` (empty: the node reports null). Set here, after
# the toolchain layers, so a new commit doesn't rebuild them.
ARG TET_GIT_SHA=""
ENV TET_GIT_SHA=${TET_GIT_SHA}
RUN if [ -n "$TET_BUILD_FEATURES" ]; then \
      cargo build --release -p tet-core --bin TET-Core --features "$TET_BUILD_FEATURES"; \
    else \
      cargo build --release -p tet-core --bin TET-Core; \
    fi

FROM debian:bookworm-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget && rm -rf /var/lib/apt/lists/*

COPY --from=build /workspace/target/release/TET-Core /usr/local/bin/TET-Core

# Matches the compose healthcheck so `docker run` without compose reports health
# too. /status is the liveness surface; there is no bare /health route.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -qO- http://127.0.0.1:5010/status >/dev/null 2>&1 || exit 1

# REST API + P2P (tcp + udp for webrtc-direct when using a fixed port).
EXPOSE 5010
EXPOSE 8002/tcp
EXPOSE 8002/udp

CMD ["TET-Core"]

