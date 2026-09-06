# syntax=docker/dockerfile:1

FROM migrate/migrate:v4.19.1

COPY db/migrations /migrations
