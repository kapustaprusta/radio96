# syntax=docker/dockerfile:1

ARG NODE_VERSION=24.20.0
ARG CADDY_VERSION=2.10.2

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine3.24 AS builder

WORKDIR /src/web

COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY web/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM caddy:${CADDY_VERSION}-alpine AS validator

COPY deploy/production/Caddyfile /etc/caddy/Caddyfile
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
    && touch /caddyfile.validated

FROM caddy:${CADDY_VERSION}-alpine

COPY deploy/production/Caddyfile /etc/caddy/Caddyfile
COPY --from=validator /caddyfile.validated /etc/caddy/.caddyfile.validated
COPY --from=builder /src/web/dist /srv

EXPOSE 80 443 443/udp
