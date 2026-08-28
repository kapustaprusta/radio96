# radio96

Легковесное голосовое приложение для общения с друзьями во время игр.

## MVP

- голосовые комнаты до 8 равноправных участников;
- вход по одноразовой ссылке без регистрации;
- Go backend и React frontend в одном deployable-приложении;
- PostgreSQL для состояния комнат;
- LiveKit Cloud для передачи аудио с возможностью перейти на self-hosted LiveKit.

Согласованный план и backend-архитектура описаны в [docs/PLAN.md](docs/PLAN.md).

## Development

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
make check       # проверить форматирование, go vet и тесты
make ci          # выполнить полный набор CI-проверок
```
