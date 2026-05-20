# Build from monorepo root: docker build -f tet-core/Dockerfile .
FROM rust:1.85-bookworm AS build

WORKDIR /build

# Workspace path dependencies (tet-core → methods, nexus-protocol)
COPY methods methods
COPY nexus-protocol nexus-protocol
COPY tet-core tet-core

WORKDIR /build/tet-core

ENV RISC0_SKIP_BUILD=1
RUN cargo build --release --bin TET-Core

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /build/tet-core/target/release/TET-Core /usr/local/bin/tet-core

EXPOSE 5010 5011

ENV TET_REST_BIND=0.0.0.0:5010

ENTRYPOINT ["/usr/local/bin/tet-core"]
