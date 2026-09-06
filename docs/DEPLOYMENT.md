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

При ручной сборке файл читают Compose и скрипт сборки образов, поэтому значения
должны быть оформлены по правилам POSIX shell. В частности, URL PostgreSQL
следует оставить в одинарных кавычках, как в `.env.production.example`.
Deployment agent сам создаёт Compose-совместимую версию этого файла только для
развёртывания на VM; её не следует передавать в `production-build` или
`production-push`.

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
одинаковым тегом. Команда публикации проверяет наличие каждого локального образа
и явно отправляет все три образа в registry; отсутствие любого образа завершает
команду ошибкой.

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
- `YC_REGISTRY_ID` — ID Yandex Container Registry;
- `PRODUCTION_SITE_URL` — origin production-сайта с HTTPS, без завершающего `/`.

Сервисному аккаунту достаточно роли `container-registry.images.pusher` на
целевой реестр. Для текущего репозитория federated credential должен разрешать
immutable subject
`repo:<owner>@<owner-id>/<repository>@<repository-id>:ref:refs/heads/main`.
Запустить публикацию повторно можно вручную через `workflow_dispatch`, выбрав
ветку `main`.

Публикация образов и production-деплой разделены. Push в `main` только собирает
образы. Развёртывание запускается отдельной кнопкой и всегда использует полный
SHA выбранного коммита.

## Развёртывание на VM

На VM нужны Docker с Compose plugin, `git`, `curl`, `jq`, `make`, `flock` из
`util-linux` и настроенный `yc`. Также нужны сетевой доступ к Managed PostgreSQL и
право скачивать registry-образы. Из интернета должны быть открыты 80/TCP, 443/TCP
и 443/UDP, а 22/TCP — только для доверенных адресов. Порт приложения 8080 и
PostgreSQL публиковать нельзя.

### Установка deployment agent

Deployment agent — это systemd timer под непривилегированным пользователем VM.
Раз в две минуты он проверяет публичный GitHub API и ищет активный ручной запуск
workflow `Deploy production`. Для найденного запроса агент:

1. повторно проверяет статус workflow и SHA;
2. убеждается, что SHA принадлежит `origin/main`;
3. получает пароль PostgreSQL и LiveKit credentials из Lockbox;
4. атомарно создаёт `.env.production` и обновляет CA bundle;
5. скачивает три образа с тегом SHA, применяет миграции и обновляет контейнеры;
6. подтверждает релиз через `/versionz` и готовность через `/readyz`.

На VM обновите checkout до версии, в которой появился deployment agent. Для
публичного репозитория используйте HTTPS remote: агенту не потребуется SSH-ключ.

```bash
cd "$HOME/radio96"
git switch main
git pull --ff-only origin main
git remote set-url origin https://github.com/kapustaprusta/radio96.git
cp deploy/production/deployer.env.example .env.production.deployer
chmod 600 .env.production.deployer
```

Заполните `.env.production.deployer`. В нём хранятся только несекретные metadata:

- GitHub repository и имя workflow;
- абсолютные пути checkout, `.env.production`, state directory и CA bundle;
- адрес сайта, ACME email, platform и registry prefix;
- параметры подключения к PostgreSQL без пароля;
- ID Lockbox-секретов и имена ключей для PostgreSQL и LiveKit;
- имя профиля `yc`, которым пользуется runtime service account.

Сами значения пароля PostgreSQL, `LIVEKIT_URL`, `LIVEKIT_API_KEY` и
`LIVEKIT_API_SECRET` в этот файл не добавляются. Перед установкой проверьте
конфигурацию, затем установите timer:

```bash
make PRODUCTION_DEPLOYER_CONFIG=.env.production.deployer production-deployer-config
make PRODUCTION_DEPLOYER_CONFIG=.env.production.deployer \
  PRODUCTION_DEPLOYER_USER="$(id -un)" \
  production-deployer-install
```

Установщик копирует конфигурацию в `/etc/radio96/deployer.env` с правами `0640`,
а root-owned копию агента — в `/usr/local/libexec/radio96`. Затем он создаёт
service и timer и запускает timer. Благодаря отдельной копии неудачный checkout
не лишит systemd исполняемого агента. Пользователь деплоя должен состоять в
группе `docker`; его `yc`-профиль должен иметь доступ к Lockbox и Container
Registry. `.env.production` после установки управляется агентом, вручную менять
его не нужно. После изменения самого deployment agent установщик нужно запустить
ещё раз; для обычных релизов это не требуется.

Проверьте установку:

```bash
systemctl status radio96-production-deploy.timer
systemctl list-timers radio96-production-deploy.timer
sudo journalctl -u radio96-production-deploy.service -n 100 --no-pager
```

### Деплой по кнопке

Откройте в GitHub `Actions` → `Deploy production` → `Run workflow`, выберите
ветку `main` и подтвердите запуск. Workflow до 10 минут ждёт появления всех трёх
образов с тегом текущего SHA, затем до 20 минут ждёт подтверждение от VM. Поэтому
кнопку можно нажать, пока основной CI ещё публикует образы. Одновременно
выполняется только один production-деплой.

Endpoint `/versionz` возвращает SHA работающего релиза и запрещает кеширование.
Он не содержит credentials или пользовательских данных. Успех workflow означает,
что `/versionz` совпал с запрошенным SHA, а `/readyz` ответил успешно.

Repository сейчас публичный, поэтому agent читает GitHub API без токена. При
переводе репозитория в private этот способ перестанет работать: до переключения
нужно добавить отдельную аутентификацию агента или self-hosted runner. Интервал
опроса рассчитан на лимит публичного unauthenticated API.

Автоматический rollback намеренно не выполняется: миграции могут быть
необратимыми. При ошибке workflow останавливается, а причину следует смотреть в
логе systemd. Последний успешный SHA сохраняется в state directory для ручного
восстановления.

### Ручной fallback

При необходимости deployment agent можно запустить немедленно:

```bash
sudo systemctl start radio96-production-deploy.service
sudo journalctl -u radio96-production-deploy.service -f
```

Старый ручной путь также остаётся доступен. Подготовьте `.env.production` и CA
bundle согласно разделу выше, укажите опубликованный SHA в
`PRODUCTION_RELEASE_TAG` и выполните из корня checkout:

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

1. `GET /healthz` и `GET /readyz` возвращают `200`, а `/versionz` — SHA релиза.
2. Главная и прямой переход на `/rooms/{inviteCode}` загружают приложение.
3. В комнату можно войти из двух разных браузеров или устройств.
4. Работают разрешение микрофона, mute, reconnect и выход из звонка.
5. В логах контейнеров нет invite-кодов, participant-токенов и credentials.

Access logs Caddy намеренно отключены, потому что URL комнаты содержит invite-код.
Runtime logger также заменяет metadata запроса на `REDACTED` перед записью ошибки.
Остальные runtime-сообщения попадают в stdout/stderr контейнера и ротируются по
настройкам Compose.
