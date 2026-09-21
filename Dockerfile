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

RUN if [ "$RISC0_SKIP_BUILD" != "1" ]; then \
      curl -LsSf https://raw.githubusercontent.com/cargo-bins/cargo-binstall/main/install-from-binstall-release.sh | bash && \
      cargo binstall cargo-risczero -y && \
      cargo risczero install; \
    fi

COPY . .
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

