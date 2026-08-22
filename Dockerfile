FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM rust:1.90-bookworm AS api
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system mnote \
    && useradd --system --gid mnote --home-dir /app mnote \
    && mkdir -p /data \
    && chown mnote:mnote /data
WORKDIR /app
COPY --from=api /src/target/release/mnote /usr/local/bin/mnote
COPY --from=web /web/dist /app/web/dist
ENV MNOTE_DATA=/data
ENV MNOTE_BIND=0.0.0.0:3000
ENV MNOTE_WEB_DIST=/app/web/dist
VOLUME ["/data"]
EXPOSE 3000
USER mnote
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["curl", "--fail", "--silent", "http://127.0.0.1:3000/api/health"]
ENTRYPOINT ["mnote"]
CMD ["serve"]
