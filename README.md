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

Требования: Go 1.27 и Make.

```bash
cp .env.example .env
make run
```

Приложение по умолчанию слушает `:8080`:

- `GET /healthz` — процесс работает;
- `GET /readyz` — процесс готов принимать запросы.

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

Требование: Docker с Compose plugin.

```bash
cp .env.example .env
make docker-up
```

Команда собирает приложение, поднимает PostgreSQL, применяет миграции и ждёт,
пока `http://localhost:8080/readyz` станет доступен. Порт можно изменить через
`HTTP_PORT` в `.env`.

```bash
make docker-ps    # показать состояние контейнеров
make docker-logs  # следить за логами приложения
make docker-down  # остановить контейнеры, сохранив данные PostgreSQL
```
