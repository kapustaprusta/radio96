# Production-развёртывание

В production на одной VM запускаются три контейнера:

- `gateway` раздаёт собранное React-приложение, завершает TLS и проксирует API;
- `app` запускает Go API и не публикует свой порт на хосте;
- `migrate` применяет миграции PostgreSQL до обновления `app`.

PostgreSQL находится за пределами Compose. В Yandex Cloud следует использовать
кластер Managed PostgreSQL в одной VPC с VM. Медиасервером остаётся LiveKit Cloud:
браузеры подключаются к нему напрямую по краткоживущим credentials от `app`.

Локальное окружение остаётся в `deploy/compose.yaml` и по-прежнему запускается
через `make docker-up`. Оно включает локальный контейнер PostgreSQL и не требует
production-конфигурации.

Для smoke-теста production-контура на Apple Silicon укажите
`PRODUCTION_PLATFORM=linux/arm64` и `PRODUCTION_SITE_ADDRESS=http://localhost`
в отдельном env-файле. Для стандартной x86-64 VM Compute Cloud оставьте
`linux/amd64`.

## Подготовка конфигурации

Создайте игнорируемый Git production env-файл:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Файл читают Compose и скрипт сборки образов, поэтому значения должны быть
оформлены по правилам POSIX shell. В частности, URL PostgreSQL следует оставить
в одинарных кавычках, как в `.env.production.example`.

Заполните:

- `PRODUCTION_SITE_ADDRESS` — публичный домен, указывающий на VM;
- `PRODUCTION_ACME_EMAIL` — контактный адрес для ACME-аккаунта Caddy;
- `PRODUCTION_PLATFORM` — архитектуру VM (`linux/amd64` для стандартной x86-64 VM);
- `PRODUCTION_IMAGE_PREFIX` — namespace образов, например
  `cr.yandex/<registry-id>`;
- `PRODUCTION_RELEASE_TAG` — полный Git SHA релиза, общий для трёх образов;
- `PRODUCTION_DATABASE_URL` — строку подключения через специальный FQDN master
  в формате `c-<cluster-id>.rw.mdb.yandexcloud.net`;
- `PRODUCTION_LIVEKIT_*` — credentials проекта LiveKit Cloud.

Не используйте `latest` или другой переиспользуемый тег для развёртывания. API,
web и migration-образам автоматически назначается один `PRODUCTION_RELEASE_TAG`.
Не переиспользуйте его: тогда релиз можно воспроизвести или откатить.
Спецсимволы пароля PostgreSQL необходимо percent-encode перед добавлением в URL.
Не добавляйте `.env.production` в Git и разрешите его чтение только пользователю,
от имени которого выполняется деплой.

В Yandex Cloud источником секретов должен быть Lockbox. На VM формируйте
`.env.production` непосредственно перед деплоем через service account с правом
чтения нужного секрета. Не помещайте значения секретов в образ, cloud-init,
репозиторий или вывод GitHub Actions.

При использовании специального current-master FQDN не добавляйте
`target_session_attrs`. PostgreSQL-драйвер migration-образа не обрабатывает эту
libpq-опцию, а `rw` FQDN уже выбирает доступный для записи хост.

Скачайте актуальный CA bundle Yandex Cloud по пути из
`PRODUCTION_DATABASE_CA_FILE`:

```bash
mkdir -p .secrets
curl --fail --silent --show-error \
  https://storage.yandexcloud.net/cloud-certs/CA.pem \
  --output .secrets/yandex-cloud-ca.pem
chmod 644 .secrets/yandex-cloud-ca.pem
```

Параметр `sslrootcert` внутри `PRODUCTION_DATABASE_URL` должен содержать путь
контейнера `/yc-ca.pem`, а не путь на хосте.

Перед сборкой или деплоем проверьте итоговую Compose-модель:

```bash
make production-config
```

Команда `docker compose config` без `--quiet` выводит раскрытые значения, включая
секреты. Не сохраняйте и не публикуйте её вывод.

## Сборка и публикация образов

Авторизуйте Docker в Yandex Container Registry, затем выполните:

```bash
git rev-parse HEAD
make production-build
make production-push
```

Запишите полученный полный SHA в `PRODUCTION_RELEASE_TAG`. Скрипт соберёт образы
`radio96-api`, `radio96-web` и `radio96-migrate` в `PRODUCTION_IMAGE_PREFIX` с
одинаковым тегом.

При использовании Podman передайте пути к установленным бинарникам:

```bash
make DOCKER_COMPOSE="/opt/podman/bin/podman compose" \
  CONTAINER_ENGINE=/opt/podman/bin/podman production-build
make DOCKER_COMPOSE="/opt/podman/bin/podman compose" production-push
```

Сборка создаёт отдельные API, web и migration-образы с единым тегом и целевой
платформой из `.env.production`. Явная платформа не позволяет случайно отправить
ARM-образ с Apple Silicon Mac на x86 VM. При несовпадении платформ у container
engine должна быть настроена эмуляция; другой вариант — собирать образы на
x86-64 CI runner.

### Автоматическая публикация из GitHub Actions

После успешных backend-, frontend- и production-проверок для push в `main`
GitHub Actions автоматически собирает и публикует три образа. Все они получают
неизменяемый тег, равный полному `${GITHUB_SHA}` merge-коммита.

Workflow использует OIDC и не хранит авторизованный ключ сервисного аккаунта.
Для него должны быть настроены repository variables:

- `YC_CI_SERVICE_ACCOUNT_ID` — ID отдельного сервисного аккаунта CI;
- `YC_REGISTRY_ID` — ID Yandex Container Registry.

Сервисному аккаунту достаточно роли `container-registry.images.pusher` на
целевой реестр. Federated credential должен разрешать subject
`repo:kapustaprusta/radio96:ref:refs/heads/main`. Запустить публикацию повторно
можно вручную через `workflow_dispatch`, выбрав ветку `main`.

Публикация образов не разворачивает их на VM. Для деплоя укажите опубликованный
SHA в `PRODUCTION_RELEASE_TAG` на VM и выполните `make production-deploy`.

## Развёртывание на VM

На VM нужны Docker с Compose plugin, сетевой доступ к Managed PostgreSQL и право
скачивать настроенные registry-образы. Из интернета должны быть открыты 80/TCP,
443/TCP и 443/UDP, а 22/TCP — только для доверенных адресов. Порт приложения 8080
и PostgreSQL публиковать нельзя.

После размещения на VM `Makefile`, `deploy/production/compose.yaml`,
`.env.production` и CA bundle базы выполните из корня deployment-каталога:

```bash
make production-deploy
```

Команда скачивает три образа и запускает миграции в отдельном одноразовом
контейнере. Только после этого обновляется API. Если миграция завершится с
ошибкой, команда остановится до замены работающего приложения. Gateway
запускается после того, как `/readyz` подтвердит доступность PostgreSQL.
Caddy получает и обновляет TLS-сертификат автоматически, поэтому volume
`caddy-data` должен переживать деплои.

Полезные операционные команды:

```bash
make production-ps
make production-logs
make production-migrate
make production-down
```

`production-down` сохраняет данные и сертификаты Caddy. Не добавляйте `--volumes`,
если не собираетесь намеренно удалить состояние сертификатов.

## Smoke-тест

После настройки DNS и TLS проверьте:

1. `GET /healthz` и `GET /readyz` возвращают `200`.
2. Главная и прямой переход на `/rooms/{inviteCode}` загружают приложение.
3. В комнату можно войти из двух разных браузеров или устройств.
4. Работают разрешение микрофона, mute, reconnect и выход из звонка.
5. В логах контейнеров нет invite-кодов, participant-токенов и credentials.

Access logs Caddy намеренно отключены, потому что URL комнаты содержит invite-код.
Runtime logger также заменяет metadata запроса на `REDACTED` перед записью ошибки.
Остальные runtime-сообщения попадают в stdout/stderr контейнера и ротируются по
настройкам Compose.
