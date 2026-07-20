# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS frontend-build
WORKDIR /build

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY index.html tsconfig.json vite.config.ts ./
COPY scripts ./scripts
COPY src ./src
COPY public ./public
RUN npm run build:frontend

FROM rust:1.88.0-bookworm AS server-build
WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends git libssl-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY src-tauri ./src-tauri
ARG CST_GIT_COMMIT=container
ENV CST_GIT_COMMIT=${CST_GIT_COMMIT}
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/build/src-tauri/target \
    cargo build \
      --locked \
      --manifest-path src-tauri/Cargo.toml \
      --profile server \
      --bin cst-server \
    && install -m 0755 src-tauri/target/server/cst-server /tmp/cst-server

FROM node:22-bookworm-slim AS runtime

ARG RUST_VERSION=1.88.0
ARG CST_GIT_COMMIT=container
LABEL org.opencontainers.image.title="Codex Switch Terminal" \
      org.opencontainers.image.description="Runtime distant de chats Codex Switch Terminal" \
      org.opencontainers.image.revision="${CST_GIT_COMMIT}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bash \
      build-essential \
      ca-certificates \
      chromium \
      curl \
      file \
      gzip \
      git \
      gosu \
      jq \
      libssl-dev \
      openssh-client \
      pkg-config \
      procps \
      python3 \
      python3-pip \
      ripgrep \
      sudo \
      tar \
      unzip \
      xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 cst \
    && useradd --uid 10001 --gid cst --create-home --home-dir /home/cst --shell /bin/bash cst \
    && install -d -o cst -g cst /srv/cst /srv/cst/workspaces /opt/codex-switch-terminal/dist

USER cst
ENV HOME=/home/cst \
    PATH=/home/cst/.local/bin:/home/cst/.cargo/bin:/usr/local/bin:/usr/bin:/bin
RUN curl --proto '=https' --tlsv1.2 -fsS https://sh.rustup.rs -o /tmp/rustup-init.sh \
    && sh /tmp/rustup-init.sh -y --profile minimal --default-toolchain "${RUST_VERSION}" \
    && rm -f /tmp/rustup-init.sh
RUN --mount=type=cache,target=/home/cst/.npm,uid=10001,gid=10001 \
    npm install --global --prefix /home/cst/.local @openai/codex @anthropic-ai/claude-code \
    && command -v codex >/dev/null \
    && codex --version \
    && command -v claude >/dev/null \
    && claude --version

USER root
COPY --from=server-build /tmp/cst-server /usr/local/bin/cst-server
COPY --from=frontend-build /build/dist /opt/codex-switch-terminal/dist
COPY deploy/docker-entrypoint.sh /usr/local/bin/cst-container-entrypoint
RUN chmod 0755 /usr/local/bin/cst-container-entrypoint /usr/local/bin/cst-server \
    && chown -R cst:cst /opt/codex-switch-terminal

ENV CST_BIND=0.0.0.0:8080 \
    CST_DATA_DIR=/srv/cst \
    CST_WORKSPACES_ROOT=/srv/cst/workspaces \
    CST_STATIC_DIR=/opt/codex-switch-terminal/dist

EXPOSE 8080
VOLUME ["/srv/cst"]
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=8 \
  CMD curl -fsS http://127.0.0.1:8080/healthz >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/cst-container-entrypoint"]
CMD ["cst-server"]
