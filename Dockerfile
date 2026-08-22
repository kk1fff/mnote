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
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=api /src/target/release/mnote /usr/local/bin/mnote
COPY --from=web /web/dist /app/web/dist
ENV MNOTE_DATA=/data
ENV MNOTE_BIND=0.0.0.0:3000
ENV MNOTE_WEB_DIST=/app/web/dist
VOLUME ["/data"]
EXPOSE 3000
ENTRYPOINT ["mnote"]
CMD ["serve"]
