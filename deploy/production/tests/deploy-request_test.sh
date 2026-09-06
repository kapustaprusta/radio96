#!/bin/sh

set -eu

fail() {
	echo "deploy-request_test: $1" >&2
	exit 1
}

script_directory=$(CDPATH='' cd "$(dirname "$0")" && pwd -P)
repository_directory=$(CDPATH='' cd "$script_directory/../../.." && pwd -P)
deployer="$repository_directory/deploy/production/deploy-request.sh"
jq_bin=$(command -v jq) || fail "jq is required"

test_directory=$(mktemp -d)
cleanup() {
	rm -rf "$test_directory"
}
trap cleanup EXIT HUP INT TERM

deployment_repository="$test_directory/repository"
mkdir -p "$deployment_repository/.git" "$deployment_repository/deploy/production"
cp "$repository_directory/deploy/production/render-env.sh" \
	"$deployment_repository/deploy/production/render-env.sh"
chmod +x "$deployment_repository/deploy/production/render-env.sh"

release_sha=0123456789abcdef0123456789abcdef01234567
run_id=123456789
command_log="$test_directory/commands.log"
make_log="$test_directory/make.log"
yc_log="$test_directory/yc.log"
deployed_marker="$test_directory/deployed"
: >"$command_log"
: >"$make_log"
: >"$yc_log"

fake_git="$test_directory/git"
cat >"$fake_git" <<'EOF'
#!/bin/sh
set -eu

printf '%s\n' "$*" >>"$RADIO96_TEST_COMMAND_LOG"
case "$*" in
	*' remote get-url origin') printf '%s\n' 'https://github.com/owner/radio96.git' ;;
esac
EOF

fake_flock="$test_directory/flock"
cat >"$fake_flock" <<'EOF'
#!/bin/sh
exit 0
EOF

fake_docker="$test_directory/docker"
cat >"$fake_docker" <<'EOF'
#!/bin/sh
exit 0
EOF

fake_make="$test_directory/make"
cat >"$fake_make" <<'EOF'
#!/bin/sh
set -eu

printf '%s\n' "$*" >>"$RADIO96_TEST_MAKE_LOG"
environment_file=
for argument in "$@"; do
	case "$argument" in
		PRODUCTION_ENV_FILE=*) environment_file=${argument#PRODUCTION_ENV_FILE=} ;;
	esac
done

[ -r "$environment_file" ]
# shellcheck disable=SC1090
. "$environment_file"
[ "$PRODUCTION_RELEASE_TAG" = "$RADIO96_TEST_SHA" ]
: >"$RADIO96_TEST_DEPLOYED_MARKER"
EOF

fake_yc="$test_directory/yc"
cat >"$fake_yc" <<'EOF'
#!/bin/sh
set -eu

key=
while [ "$#" -gt 0 ]; do
	if [ "$1" = "--key" ]; then
		key=$2
		shift 2
	else
		shift
	fi
done

printf '%s\n' "$key" >>"$RADIO96_TEST_YC_LOG"
case "$key" in
	postgresql_password) printf '%s' 'database-password' ;;
	LIVEKIT_URL) printf '%s' 'wss://radio96-test.livekit.cloud' ;;
	LIVEKIT_API_KEY) printf '%s' 'test-api-key' ;;
	LIVEKIT_API_SECRET) printf '%s' 'test-api-secret' ;;
	*) exit 1 ;;
esac
EOF

fake_curl="$test_directory/curl"
cat >"$fake_curl" <<'EOF'
#!/bin/sh
set -eu

output=
url=
while [ "$#" -gt 0 ]; do
	case "$1" in
		--output)
			output=$2
			shift 2
			;;
		https://*)
			url=$1
			shift
			;;
		*) shift ;;
	esac
done

case "$url" in
	https://api.github.com/repos/owner/radio96/actions/workflows/deploy-production.yml/runs\?*)
		printf '{"workflow_runs":[{"id":%s,' "$RADIO96_TEST_RUN_ID"
		printf '"status":"in_progress","event":"workflow_dispatch",'
		printf '"head_branch":"main","head_sha":"%s",' "$RADIO96_TEST_SHA"
		printf '"head_repository":{"full_name":"owner/radio96"}}]}\n'
		;;
	https://api.github.com/repos/owner/radio96/actions/runs/*)
		printf '{"id":%s,"status":"in_progress",' "$RADIO96_TEST_RUN_ID"
		printf '"event":"workflow_dispatch","head_branch":"main",'
		printf '"head_sha":"%s",' "$RADIO96_TEST_SHA"
		printf '"head_repository":{"full_name":"owner/radio96"}}\n'
		;;
	https://storage.example/CA.pem)
		[ -n "$output" ]
		printf '%s\n' 'test-ca-bundle' >"$output"
		;;
	https://radio96.example.com/versionz)
		if [ -f "$RADIO96_TEST_DEPLOYED_MARKER" ]; then
			printf '%s' "$RADIO96_TEST_SHA"
		else
			printf '%s' 'previous-release'
		fi
		;;
	https://radio96.example.com/readyz)
		printf '%s\n' '{"status":"ok"}'
		;;
	*) exit 1 ;;
esac
EOF

chmod +x "$fake_git" "$fake_flock" "$fake_docker" "$fake_make" "$fake_yc" "$fake_curl"

environment_file="$deployment_repository/.env.production"
ca_file="$deployment_repository/.secrets/yandex-ca.pem"
state_directory="$test_directory/state"
config_file="$test_directory/deployer.env"
cat >"$config_file" <<EOF
RADIO96_GITHUB_REPOSITORY=owner/radio96
RADIO96_GITHUB_WORKFLOW=deploy-production.yml
RADIO96_REPOSITORY_DIR=$deployment_repository
RADIO96_PRODUCTION_ENV_FILE=$environment_file
RADIO96_DEPLOYER_STATE_DIR=$state_directory
RADIO96_SITE_URL=https://radio96.example.com
RADIO96_SITE_ADDRESS=radio96.example.com
RADIO96_ACME_EMAIL=admin@example.com
RADIO96_IMAGE_PREFIX=cr.yandex/example
RADIO96_PLATFORM=linux/amd64
RADIO96_DATABASE_HOST=c-example.rw.mdb.yandexcloud.net
RADIO96_DATABASE_PORT=6432
RADIO96_DATABASE_NAME=radio96
RADIO96_DATABASE_USER=radio96
RADIO96_DATABASE_SECRET_ID=database-secret
RADIO96_DATABASE_PASSWORD_KEY=postgresql_password
RADIO96_DATABASE_CA_FILE=$ca_file
RADIO96_DATABASE_CA_URL=https://storage.example/CA.pem
RADIO96_LIVEKIT_SECRET_ID=livekit-secret
RADIO96_LIVEKIT_URL_KEY=LIVEKIT_URL
RADIO96_LIVEKIT_API_KEY_KEY=LIVEKIT_API_KEY
RADIO96_LIVEKIT_API_SECRET_KEY=LIVEKIT_API_SECRET
RADIO96_YC_PROFILE=radio96-runtime
EOF

export RADIO96_DEPLOYER_CONFIG="$config_file"
export RADIO96_CURL_BIN="$fake_curl"
export RADIO96_JQ_BIN="$jq_bin"
export RADIO96_GIT_BIN="$fake_git"
export RADIO96_FLOCK_BIN="$fake_flock"
export RADIO96_MAKE_BIN="$fake_make"
export RADIO96_DOCKER_BIN="$fake_docker"
export RADIO96_YC_BIN="$fake_yc"
export RADIO96_TEST_COMMAND_LOG="$command_log"
export RADIO96_TEST_MAKE_LOG="$make_log"
export RADIO96_TEST_YC_LOG="$yc_log"
export RADIO96_TEST_DEPLOYED_MARKER="$deployed_marker"
export RADIO96_TEST_RUN_ID="$run_id"
export RADIO96_TEST_SHA="$release_sha"

deployer_output=$("$deployer" 2>&1)
case "$deployer_output" in
	*'database-password'* | *'test-api-key'* | *'test-api-secret'*) fail "secret value was written to deployer output" ;;
esac

[ "$(sed -n '1p' "$state_directory/last-request")" = "$run_id" ] || fail "workflow run ID was not persisted"
[ "$(sed -n '1p' "$state_directory/current-release")" = "$release_sha" ] || fail "release SHA was not persisted"
grep -q "fetch --quiet origin main" "$command_log" || fail "origin/main was not fetched"
grep -q "switch --detach --force $release_sha" "$command_log" || fail "requested release was not checked out"
grep -q "production-deploy" "$make_log" || fail "production deployment target was not invoked"

: >"$make_log"
"$deployer" >/dev/null
[ ! -s "$make_log" ] || fail "an already handled workflow run was deployed twice"

echo "deploy-request tests passed"
