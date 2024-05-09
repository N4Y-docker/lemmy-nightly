# syntax=docker/dockerfile:1.7
ARG RUST_VERSION=1.77
ARG CARGO_BUILD_FEATURES=default
ARG RUST_RELEASE_MODE=debug

ARG BUILDER_IMAGE=rust:${RUST_VERSION}

ARG RUNNER_IMAGE=debian:bookworm-slim

ARG UNAME=lemmy
ARG UID=1000
ARG GID=1000

FROM ${BUILDER_IMAGE} AS build

ARG CARGO_BUILD_FEATURES
ARG RUST_RELEASE_MODE
ARG RUSTFLAGS

WORKDIR /lemmy

COPY . ./

# Debug build
RUN --mount=type=cache,target=/lemmy/target set -ex; \
    if [ "${RUST_RELEASE_MODE}" = "debug" ]; then \
        cargo build --features "${CARGO_BUILD_FEATURES}"; \
        mv target/"${RUST_RELEASE_MODE}"/lemmy_server ./lemmy_server; \
    fi

# Release build
RUN --mount=type=cache,target=/lemmy/target set -ex; \
    if [ "${RUST_RELEASE_MODE}" = "release" ]; then \
        cargo clean --release; \
        cargo build --features "${CARGO_BUILD_FEATURES}" --release; \
        mv target/"${RUST_RELEASE_MODE}"/lemmy_server ./lemmy_server; \
    fi


FROM ${RUNNER_IMAGE} AS runner-linux

# Add system packages that are needed: federation needs CA certificates, curl can be used for healthchecks
RUN apt update && apt install -y libssl-dev libpq-dev ca-certificates curl

COPY --from=build --chmod=0755 /lemmy/lemmy_server /usr/local/bin


# Final image that use a base runner based on the target OS
FROM runner-${TARGETOS}

LABEL org.opencontainers.image.authors="The Lemmy Authors"
LABEL org.opencontainers.image.source="https://github.com/LemmyNet/lemmy"
LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later"
LABEL org.opencontainers.image.description="A link aggregator and forum for the fediverse"

ARG UNAME
ARG GID
ARG UID

RUN groupadd -g ${GID} -o ${UNAME} && \
    useradd -m -u ${UID} -g ${GID} -o -s /bin/bash ${UNAME}
USER $UNAME

ENTRYPOINT ["lemmy_server"]
EXPOSE 8536
STOPSIGNAL SIGTERM
