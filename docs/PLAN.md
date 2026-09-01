# radio96 MVP — план и backend-архитектура

## Summary

Построить модульный Go-монолит на Go 1.27: один HTTP-сервис раздаёт React SPA и API, PostgreSQL хранит одноразовые комнаты, LiveKit Cloud передаёт аудио. Backend допускает несколько реплик и поздний переход на self-hosted LiveKit без изменения API клиента.

## Backend Architecture

- Макроархитектура: модульный монолит с гексагональными границами, DDD-lite для модели комнаты и плоской feature-first структурой пакетов.
- Один Go-процесс обслуживает HTTP API, React SPA и фоновые lifecycle-задачи; PostgreSQL и LiveKit остаются внешними системами.
- Стандартный `net/http` и `http.ServeMux`; handlers не содержат бизнес-логику.
- `pgx/v5 + sqlc`: SQL пишется вручную, Go-типы и методы генерируются.
- Миграции выполняются отдельным `golang-migrate` init-job до запуска сервиса.
- `internal/room` объединяет доменную модель и use cases: CreateRoom, GetRoom, JoinRoom и обработку lifecycle-событий.
- Порты хранилища и медиа-шлюза объявляются рядом с использующим их кодом в `internal/room`; отдельные пакеты `interfaces`, `common`, `utils` и `models` не создаются.
- Адаптеры `internal/postgres` и `internal/livekit` реализуют порты `room`; `internal/httpapi` и `internal/reconcile` вызывают use cases.
- `internal/app` — единственный composition root: создаёт зависимости, запускает HTTP-сервер и lifecycle worker.
- Зависимости направлены внутрь: `room` не импортирует HTTP, pgx, sqlc-generated code или LiveKit SDK.
- JSON-логи через `slog`, request ID, Prometheus-метрики, `/healthz` и `/readyz`.
- Конфигурация только через environment; secrets и invite-коды не логируются.

### Project Structure

```text
radio96/
├── cmd/radio96/main.go
├── internal/
│   ├── app/                 # composition root, lifecycle, graceful shutdown
│   ├── room/                # Room, статусы, ошибки, порты и use cases
│   ├── httpapi/             # router, handlers, middleware, HTTP errors
│   ├── postgres/            # pgx repositories и dbgen от sqlc
│   ├── livekit/             # токены, webhook validation и RoomService client
│   ├── reconcile/           # expiry и страховка пропущенных webhook
│   ├── config/              # environment configuration
│   ├── telemetry/           # slog и Prometheus
│   └── webapp/              # embed собранного React SPA
├── api/openapi.yaml
├── db/
│   ├── migrations/
│   └── queries/
├── web/                     # React application
├── deploy/                  # Dockerfile и local compose
├── sqlc.yaml
├── go.mod
└── go.sum
```

Состояние комнаты приложения и существование медиасессии разделены. Запись Room в PostgreSQL существует с момента создания ссылки; LiveKit room может в этот момент отсутствовать и создаётся автоматически при первом подключении.

## Room Lifecycle and Consistency

Статусы:

```text
open → active → finished
  └──────────→ expired
```

- Invite-код: 256 случайных бит; PostgreSQL хранит только SHA-256 hash.
- Создание:
  1. одной транзакцией записать Room в статусе `open` с детерминированным `livekit_room_name`;
  2. вернуть invite URL сразу после commit, не вызывая LiveKit;
  3. LiveKit автоматически создаёт медиакомнату при подключении первого участника.
- Вход:
  - найти комнату по hash;
  - для `open` проверить срок действия и выдать JWT с room configuration `max_participants=8`;
  - для `active` проверить существование и заполненность через LiveKit; если медиакомната уже отсутствует, атомарно завершить Room и отказать в повторном входе;
  - выдать JWT на 10 минут с уникальным identity, display name и правом
    публиковать только microphone track;
  - наличие устройства и browser permission не являются условием входа:
    участник может подключиться без публикации audio track.
- `room_started` переводит комнату в `active`; `room_finished` — необратимо в `finished`.
- Webhook проверяется Go-библиотекой LiveKit; ID событий сохраняются в `webhook_events` для идемпотентности.
- Reconciler страхует недоставленные webhook:
  - несколько реплик координируются PostgreSQL advisory lock;
  - завершает `active`, отсутствующие в LiveKit;
  - переводит в `expired` комнаты `open`, которые не стартовали за час.
- LiveKit остаётся источником истины для фактического лимита участников; предварительная проверка backend улучшает UX, но конкурентный девятый вход окончательно блокирует сам LiveKit.

## Public Interfaces

OpenAPI — источник истины; TypeScript types/client генерируются для frontend.

- `POST /api/v1/rooms` → `201` с `roomId`, `inviteUrl`, `expiresAt`, `maxParticipants`.
- `roomId` — непрозрачный application ID из `Room.ID()`: он не отображается как
  название комнаты и не используется для построения ссылки.
- При реализации HTTP adapter вернуть `roomId` из `Room.ID()` и включить поле в
  сгенерированный TypeScript client и contract-тесты.
- Отдельная ручка получения ссылки не нужна: при создании backend возвращает
  `inviteUrl` вида `/rooms/{inviteCode}`, а после перехода frontend копирует
  текущий URL. Из хранимого SHA-256 hash восстановить invite-код и ссылку нельзя.
- `GET /api/v1/rooms/{inviteCode}` → публичный status комнаты без внутреннего LiveKit name.
- `POST /api/v1/rooms/{inviteCode}/join` с display name → `serverUrl`, `participantToken`, `participantIdentity`;
  наличие микрофона в запросе не передаётся и не проверяется backend.
- [ ] Реализовать listener mode во frontend: при denied permission или
  отсутствии устройства показывать «Войти без микрофона» и подключаться к
  LiveKit без создания local audio track.
- `POST /api/v1/livekit/webhook` → подписанные события LiveKit.
- Единая ошибка: `{ "code": "...", "message": "..." }`.
- Основные коды: `invalid_name`, `room_not_found`, `room_expired`, `room_finished`, `room_full`, `media_unavailable`.
- Display name: 1–32 Unicode-символа после trim; дубликаты разрешены.
- Ответы комнат не кешируются; `Referrer-Policy: no-referrer`; access logs используют шаблон маршрута, а не секретный URL.
- SPA и API работают на одном origin, CORS не включается.

## Test and Delivery Plan

- Unit: состояния и переходы Room, validation, invite hashing, application services с fake LiveKit/clock/random.
- HTTP: handlers и error mapping через `httptest`.
- PostgreSQL: миграции, sqlc queries, webhook deduplication и конкурентные переходы через testcontainers.
- Reconciler: две конкурентные реплики, advisory lock, истечение неиспользованных ссылок и пропущенный `room_finished`.
- LiveKit smoke suite: автоматическое создание комнаты при первом входе, вход
  без microphone track, восемь участников, отказ девятому и завершение после
  выхода последнего.
- Contract: OpenAPI validation, обязательные `roomId` и корректный
  `/rooms/{inviteCode}` в create response, компиляция сгенерированного TypeScript client.
- CI: `go test -race ./...`, sqlc verification, frontend typecheck/tests/build, Docker build.
- Local environment: Docker Compose с PostgreSQL и migrate job; LiveKit остаётся Cloud.
- Production: provider-neutral Go image, отдельный PostgreSQL и pre-deploy migrate job.
- Поздний self-hosting меняет только LiveKit URL/credentials и webhook configuration.
- После web-MVP тот же frontend упаковывается в Tauri для Windows с tray и global push-to-talk.

## Fixed Assumptions

- До 8 равноправных участников, без аккаунтов и ведущего.
- Участник может войти без микрофона, слышит остальных и учитывается в общем
  лимите комнаты.
- Одноразовая ссылка ожидает первый вход один час и не открывается повторно после завершения звонка.
- Первая web-версия поддерживает desktop Chrome.
- Backend сразу поддерживает горизонтальное масштабирование.
- PostgreSQL вместо SQLite; Redis, очередь и outbox в v1 не используются.
