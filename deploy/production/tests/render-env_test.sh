#!/bin/sh

set -eu

fail() {
	echo "render-env_test: $1" >&2
	exit 1
}

assert_environment_line() {
	expected_line=$1

	grep -Fqx "$expected_line" "$environment_file" || fail "generated environment is missing: $expected_line"
}

file_mode() {
	if stat -c '%a' "$1" >/dev/null 2>&1; then
		stat -c '%a' "$1"
	else
		stat -f '%Lp' "$1"
	fi
}

script_directory=$(CDPATH='' cd "$(dirname "$0")" && pwd -P)
repository_directory=$(CDPATH='' cd "$script_directory/../../.." && pwd -P)
renderer="$repository_directory/deploy/production/render-env.sh"
jq_bin=$(command -v jq) || fail "jq is required"

test_directory=$(mktemp -d)
cleanup() {
	rm -rf "$test_directory"
}
trap cleanup EXIT HUP INT TERM

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
	postgresql_password) printf '%s' 'p@ss $word:/?#[]' ;;
	LIVEKIT_URL) printf '%s' 'wss://radio96-test.livekit.cloud' ;;
	LIVEKIT_API_KEY) printf '%s' 'test-api-key' ;;
	LIVEKIT_API_SECRET) printf '%s' "live'\$kit \${secret}" ;;
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

[ "$url" = "https://storage.example/CA.pem" ] || exit 1
[ -n "$output" ] || exit 1
printf '%s\n' 'test-ca-bundle' >"$output"
EOF

chmod +x "$fake_yc" "$fake_curl"

environment_file="$test_directory/.env.production"
ca_file="$test_directory/secrets/yandex-ca.pem"
config_file="$test_directory/deployer.env"
yc_log="$test_directory/yc.log"
: >"$yc_log"

cat >"$config_file" <<EOF
RADIO96_REPOSITORY_DIR=$repository_directory
RADIO96_PRODUCTION_ENV_FILE=$environment_file
RADIO96_SITE_URL=https://radio96.example.com
RADIO96_SITE_ADDRESS=radio96.example.com
RADIO96_ACME_EMAIL=admin@example.com
RADIO96_IMAGE_PREFIX=cr.yandex/example
RADIO96_PLATFORM=linux/amd64
RADIO96_DATABASE_HOST=c-example.rw.mdb.yandexcloud.net
RADIO96_DATABASE_PORT=6432
RADIO96_DATABASE_NAME='radio96 database'
RADIO96_DATABASE_USER='radio96 user'
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

release_sha=0123456789abcdef0123456789abcdef01234567
render_output=$(RADIO96_DEPLOYER_CONFIG="$config_file" \
	RADIO96_YC_BIN="$fake_yc" \
	RADIO96_CURL_BIN="$fake_curl" \
	RADIO96_JQ_BIN="$jq_bin" \
	RADIO96_TEST_YC_LOG="$yc_log" \
	"$renderer" "$release_sha" 2>&1)

# shellcheck disable=SC2016
case "$render_output" in
	*'p@ss $word'* | *'test-api-key'* | *"live'\$kit \${secret}"*) fail "secret value was written to command output" ;;
esac

[ -s "$ca_file" ] || fail "CA bundle was not written"
[ "$(file_mode "$ca_file")" = "644" ] || fail "CA bundle mode must be 644"
[ "$(file_mode "$environment_file")" = "600" ] || fail "production environment mode must be 600"

expected_database_url='postgres://radio96%20user:p%40ss%20%24word%3A%2F%3F%23%5B%5D'
expected_database_url="${expected_database_url}@c-example.rw.mdb.yandexcloud.net:6432/radio96%20database"
expected_database_url="${expected_database_url}?sslmode=verify-full&sslrootcert=/yc-ca.pem"
assert_environment_line "PRODUCTION_RELEASE_TAG='$release_sha'"
assert_environment_line "PRODUCTION_LIVEKIT_URL='wss://radio96-test.livekit.cloud'"
assert_environment_line "PRODUCTION_LIVEKIT_API_KEY='test-api-key'"
assert_environment_line "PRODUCTION_LIVEKIT_API_SECRET='live\\'\$kit \${secret}'"
assert_environment_line "PRODUCTION_DATABASE_CA_FILE='$ca_file'"
assert_environment_line "PRODUCTION_DATABASE_URL='$expected_database_url'"

: >"$yc_log"
RADIO96_DEPLOYER_CONFIG="$config_file" \
	RADIO96_YC_BIN="$fake_yc" \
	RADIO96_CURL_BIN="$fake_curl" \
	RADIO96_JQ_BIN="$jq_bin" \
	RADIO96_TEST_YC_LOG="$yc_log" \
	"$renderer" --check-config >/dev/null
[ ! -s "$yc_log" ] || fail "configuration check must not read Lockbox secrets"

if RADIO96_DEPLOYER_CONFIG="$config_file" \
	RADIO96_YC_BIN="$fake_yc" \
	RADIO96_CURL_BIN="$fake_curl" \
	RADIO96_JQ_BIN="$jq_bin" \
	RADIO96_TEST_YC_LOG="$yc_log" \
	"$renderer" not-a-sha >/dev/null 2>&1; then
	fail "invalid release SHA was accepted"
fi

echo "render-env tests passed"
