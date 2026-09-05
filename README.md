# radio96

Легковесное голосовое приложение для общения с друзьями во время игр.

## MVP

- голосовые комнаты до 8 равноправных участников;
- вход по одноразовой ссылке без регистрации;
- Go backend и React frontend в одном deployable-приложении;
- PostgreSQL для состояния комнат;
- LiveKit Cloud для передачи аудио с возможностью перейти на self-hosted LiveKit.

Согласованный план и backend-архитектура описаны в [docs/PLAN.md](docs/PLAN.md),
интерфейс web-MVP — в [docs/UI_SPEC.md](docs/UI_SPEC.md), а его состояния и
переходы можно посмотреть в [основном интерактивном макете](docs/radio96-design-mockups.html).

## API contract

HTTP API описан в [api/openapi.yaml](api/openapi.yaml). Команды `make test` и
`make ci` проверяют OpenAPI-документ как часть Go-тестов.

## Development with Go

Требования: Go 1.27, Make и PostgreSQL с применёнными миграциями.
Для локальной базы можно использовать Compose:

```bash
cp .env.example .env
make docker-db
make run
```

Приложение по умолчанию слушает `:8080`:

- `GET /healthz` — процесс работает;
- `GET /readyz` — PostgreSQL доступен; при недоступности базы возвращается `503`;
- `POST /api/v1/rooms` — создать комнату и получить ссылку;
- `GET /api/v1/rooms/{inviteCode}` — проверить состояние комнаты;
- `POST /api/v1/rooms/{inviteCode}/join` — получить credentials для подключения к LiveKit.

`DATABASE_URL` обязателен. При старте приложение подключается к базе с
`DATABASE_CONNECT_TIMEOUT` (по умолчанию `5s`) и прекращает запуск, если база
недоступна. Миграции не запускаются из Go-процесса.

### LiveKit

Пока проекта LiveKit Cloud нет, оставьте `LIVEKIT_URL`, `LIVEKIT_API_KEY` и
`LIVEKIT_API_SECRET` пустыми. Создание ссылок и проверка состояния работают,
но `/join` возвращает `503` с кодом `media_unavailable`.

Для подключения голосового сервиса заполните все три переменные в `.env`
и перезапустите приложение. `LIVEKIT_URL` — адрес с протоколом `wss://`
(для self-hosted разработки также допускается `ws://`). Секрет и API key
используются только бэкендом; не добавляйте их в `VITE_*`, Git или сообщения.
`MEDIA_REQUEST_TIMEOUT` ограничивает обращения к медиа-шлюзу (по умолчанию `5s`).

`/readyz` проверяет базу, а не LiveKit. Наличие credentials и успешная выдача
JWT ещё не подтверждают реальное подключение к Cloud. Для этого нужен smoke
test в браузере с настоящим проектом.

В этом срезе доступны HTTP-ручки создания, получения комнаты и входа.
Webhook, reconciler и раздача собранного SPA из Go остаются следующими этапами.
До реализации lifecycle нельзя считать одноразовость ссылки после завершения
медиасессии полностью обеспеченной.

Основные команды:

```bash
make help        # показать доступные команды
make run         # запустить приложение
make build       # собрать bin/radio96
make test        # запустить тесты
make test-race   # запустить тесты с race detector
make fmt         # отформатировать Go-код
make lint        # запустить golangci-lint
make lint-fix    # автоматически исправить доступные lint-ошибки
make check       # проверить форматирование, lint и тесты
make ci          # выполнить полный набор CI-проверок
```

При первом запуске `make lint` устанавливает закреплённую версию `golangci-lint`
в игнорируемый каталог `bin/`.

## Development with Docker

Требование: Docker с Compose plugin либо запущенная Podman machine с Compose provider.

```bash
cp .env.example .env
make docker-up
```

Для Podman используется тот же Compose-файл:

```bash
make DOCKER_COMPOSE="podman compose" docker-up
```

Если `podman` ещё не добавлен в `PATH`, укажите его полный путь, например
`DOCKER_COMPOSE="/opt/podman/bin/podman compose"`.

Команда собирает приложение, поднимает PostgreSQL, применяет миграции и ждёт,
пока `http://localhost:8080/readyz` станет доступен. Порт можно изменить через
`HTTP_PORT` в `.env`.

```bash
make docker-ps    # показать состояние контейнеров
make docker-logs  # следить за логами приложения
make docker-down  # остановить контейнеры, сохранив данные PostgreSQL
make docker-db    # поднять только PostgreSQL и применить миграции для make run
```

## Integration tests

`make ci` проверяет форматирование, sqlc, линтер и все Go-тесты с race detector.
Интеграционные тесты создают отдельный PostgreSQL через Testcontainers и
проверяют HTTP → use case → repository, readiness и подпись JWT без обращения
к Cloud. При недоступном контейнерном runtime эти тесты пропускаются — это не
равнозначно успешной интеграционной проверке.

Для Podman на macOS укажите сокет своей машины:

```bash
DOCKER_HOST="unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')" \
  TESTCONTAINERS_RYUK_DISABLED=true make ci
```

Тесты удаляют свои временные контейнеры при обычном завершении. С отключённым
Ryuk после аварийного прерывания процесса тестовый контейнер может остаться.
