#!/bin/sh

set -eu
umask 077

fail() {
	echo "$1" >&2
	exit 1
}

require_command() {
	required_command=$1

	case "$required_command" in
		*/*)
			[ -x "$required_command" ] || fail "required command is not executable: $required_command"
			;;
		*)
			command -v "$required_command" >/dev/null 2>&1 || fail "required command is not available: $required_command"
			;;
	esac
}

require_absolute_path() {
	path_name=$1
	path_value=$2

	case "$path_value" in
		/*) ;;
		*) fail "$path_name must be an absolute path" ;;
	esac
}

validate_release_tag() {
	tag=$1

	[ "${#tag}" -eq 40 ] || fail "release tag must be a full lowercase Git commit SHA"
	case "$tag" in
		*[!0-9a-f]*) fail "release tag must be a full lowercase Git commit SHA" ;;
	esac
}

lockbox_value() {
	secret_id=$1
	secret_key=$2

	if [ -n "${RADIO96_YC_PROFILE:-}" ]; then
		"$yc_bin" lockbox payload get \
			--id "$secret_id" \
			--key "$secret_key" \
			--profile "$RADIO96_YC_PROFILE"
	else
		"$yc_bin" lockbox payload get --id "$secret_id" --key "$secret_key"
	fi
}

url_encode() {
	# shellcheck disable=SC2016
	printf '%s' "$1" | "$jq_bin" --slurp --raw-input --raw-output '@uri'
}

compose_quote() {
	# Compose single-quoted values keep dollar signs literal and escape apostrophes as \'.
	# shellcheck disable=SC2016
	printf '%s' "$1" | "$jq_bin" --slurp --raw-input --raw-output \
		'"\u0027" + (gsub("\u0027"; "\\\u0027")) + "\u0027"'
}

write_variable() {
	variable_name=$1
	variable_value=$2
	quoted_value=$(compose_quote "$variable_value")

	printf '%s=%s\n' "$variable_name" "$quoted_value" >>"$environment_tmp"
}

mode=${1:-}
if [ "$mode" = "--check-config" ]; then
	check_only=true
	release_tag=0000000000000000000000000000000000000000
else
	check_only=false
	release_tag=$mode
fi

validate_release_tag "$release_tag"

config_file=${RADIO96_DEPLOYER_CONFIG:-/etc/radio96/deployer.env}
case "$config_file" in
	*/*) ;;
	*) config_file="./$config_file" ;;
esac

[ -r "$config_file" ] || fail "deployer configuration is not readable: $config_file"

# The deployer configuration is installed root-owned and contains metadata only.
# shellcheck disable=SC1090
. "$config_file"

: "${RADIO96_REPOSITORY_DIR:?RADIO96_REPOSITORY_DIR is required}"
: "${RADIO96_PRODUCTION_ENV_FILE:?RADIO96_PRODUCTION_ENV_FILE is required}"
: "${RADIO96_SITE_URL:?RADIO96_SITE_URL is required}"
: "${RADIO96_SITE_ADDRESS:?RADIO96_SITE_ADDRESS is required}"
: "${RADIO96_ACME_EMAIL:?RADIO96_ACME_EMAIL is required}"
: "${RADIO96_IMAGE_PREFIX:?RADIO96_IMAGE_PREFIX is required}"
: "${RADIO96_PLATFORM:?RADIO96_PLATFORM is required}"
: "${RADIO96_DATABASE_HOST:?RADIO96_DATABASE_HOST is required}"
: "${RADIO96_DATABASE_PORT:?RADIO96_DATABASE_PORT is required}"
: "${RADIO96_DATABASE_NAME:?RADIO96_DATABASE_NAME is required}"
: "${RADIO96_DATABASE_USER:?RADIO96_DATABASE_USER is required}"
: "${RADIO96_DATABASE_SECRET_ID:?RADIO96_DATABASE_SECRET_ID is required}"
: "${RADIO96_DATABASE_PASSWORD_NAME:?RADIO96_DATABASE_PASSWORD_NAME is required}"
: "${RADIO96_DATABASE_CA_FILE:?RADIO96_DATABASE_CA_FILE is required}"
: "${RADIO96_DATABASE_CA_URL:?RADIO96_DATABASE_CA_URL is required}"
: "${RADIO96_LIVEKIT_SECRET_ID:?RADIO96_LIVEKIT_SECRET_ID is required}"
: "${RADIO96_LIVEKIT_URL_NAME:?RADIO96_LIVEKIT_URL_NAME is required}"
: "${RADIO96_LIVEKIT_API_KEY_NAME:?RADIO96_LIVEKIT_API_KEY_NAME is required}"
: "${RADIO96_LIVEKIT_API_SECRET_NAME:?RADIO96_LIVEKIT_API_SECRET_NAME is required}"

require_absolute_path RADIO96_REPOSITORY_DIR "$RADIO96_REPOSITORY_DIR"
require_absolute_path RADIO96_PRODUCTION_ENV_FILE "$RADIO96_PRODUCTION_ENV_FILE"
require_absolute_path RADIO96_DATABASE_CA_FILE "$RADIO96_DATABASE_CA_FILE"

case "$RADIO96_SITE_URL" in
	https://*) ;;
	*) fail "RADIO96_SITE_URL must use https" ;;
esac

case "$RADIO96_DATABASE_CA_URL" in
	https://*) ;;
	*) fail "RADIO96_DATABASE_CA_URL must use https" ;;
esac

case "$RADIO96_DATABASE_HOST" in
	*[!A-Za-z0-9.-]* | .* | *.) fail "RADIO96_DATABASE_HOST is invalid" ;;
esac

case "$RADIO96_DATABASE_PORT" in
	'' | *[!0-9]*) fail "RADIO96_DATABASE_PORT must be a number" ;;
esac
if [ "$RADIO96_DATABASE_PORT" -lt 1 ] || [ "$RADIO96_DATABASE_PORT" -gt 65535 ]; then
	fail "RADIO96_DATABASE_PORT must be between 1 and 65535"
fi

yc_bin=${RADIO96_YC_BIN:-yc}
curl_bin=${RADIO96_CURL_BIN:-curl}
jq_bin=${RADIO96_JQ_BIN:-jq}

require_command "$yc_bin"
require_command "$curl_bin"
require_command "$jq_bin"

if [ "$check_only" = true ]; then
	echo "Production deployer configuration is valid"
	exit 0
fi

database_password=$(lockbox_value "$RADIO96_DATABASE_SECRET_ID" "$RADIO96_DATABASE_PASSWORD_NAME")
livekit_url=$(lockbox_value "$RADIO96_LIVEKIT_SECRET_ID" "$RADIO96_LIVEKIT_URL_NAME")
livekit_api_key=$(lockbox_value "$RADIO96_LIVEKIT_SECRET_ID" "$RADIO96_LIVEKIT_API_KEY_NAME")
livekit_api_secret=$(lockbox_value "$RADIO96_LIVEKIT_SECRET_ID" "$RADIO96_LIVEKIT_API_SECRET_NAME")

[ -n "$database_password" ] || fail "PostgreSQL password in Lockbox is empty"
[ -n "$livekit_url" ] || fail "LiveKit URL in Lockbox is empty"
[ -n "$livekit_api_key" ] || fail "LiveKit API key in Lockbox is empty"
[ -n "$livekit_api_secret" ] || fail "LiveKit API secret in Lockbox is empty"

case "$livekit_url" in
	wss://*) ;;
	*) fail "LiveKit URL from Lockbox must use wss" ;;
esac

encoded_database_user=$(url_encode "$RADIO96_DATABASE_USER")
encoded_database_password=$(url_encode "$database_password")
encoded_database_name=$(url_encode "$RADIO96_DATABASE_NAME")
database_url="postgres://${encoded_database_user}:${encoded_database_password}"
database_url="${database_url}@${RADIO96_DATABASE_HOST}:${RADIO96_DATABASE_PORT}/${encoded_database_name}"
database_url="${database_url}?sslmode=verify-full&sslrootcert=/yc-ca.pem"

ca_directory=$(dirname "$RADIO96_DATABASE_CA_FILE")
environment_directory=$(dirname "$RADIO96_PRODUCTION_ENV_FILE")
mkdir -p "$ca_directory" "$environment_directory"

ca_tmp=$(mktemp "${RADIO96_DATABASE_CA_FILE}.tmp.XXXXXX")
environment_tmp=$(mktemp "${RADIO96_PRODUCTION_ENV_FILE}.tmp.XXXXXX")
cleanup() {
	rm -f "$ca_tmp" "$environment_tmp"
}
trap cleanup EXIT HUP INT TERM

"$curl_bin" --fail --silent --show-error --location \
	--proto '=https' \
	--proto-redir '=https' \
	--max-time 30 \
	--output "$ca_tmp" \
	"$RADIO96_DATABASE_CA_URL"
[ -s "$ca_tmp" ] || fail "downloaded Yandex Cloud CA file is empty"
chmod 644 "$ca_tmp"
mv "$ca_tmp" "$RADIO96_DATABASE_CA_FILE"

: >"$environment_tmp"
chmod 600 "$environment_tmp"

write_variable PRODUCTION_SITE_ADDRESS "$RADIO96_SITE_ADDRESS"
write_variable PRODUCTION_ACME_EMAIL "$RADIO96_ACME_EMAIL"
write_variable PRODUCTION_HTTP_PORT "${RADIO96_HTTP_PORT:-80}"
write_variable PRODUCTION_HTTPS_PORT "${RADIO96_HTTPS_PORT:-443}"
write_variable PRODUCTION_PLATFORM "$RADIO96_PLATFORM"
write_variable PRODUCTION_IMAGE_PREFIX "$RADIO96_IMAGE_PREFIX"
write_variable PRODUCTION_RELEASE_TAG "$release_tag"
write_variable PRODUCTION_DATABASE_URL "$database_url"
write_variable PRODUCTION_DATABASE_CA_FILE "$RADIO96_DATABASE_CA_FILE"
write_variable PRODUCTION_DATABASE_CONNECT_TIMEOUT "${RADIO96_DATABASE_CONNECT_TIMEOUT:-5s}"
write_variable PRODUCTION_LIVEKIT_URL "$livekit_url"
write_variable PRODUCTION_LIVEKIT_API_KEY "$livekit_api_key"
write_variable PRODUCTION_LIVEKIT_API_SECRET "$livekit_api_secret"
write_variable PRODUCTION_MEDIA_REQUEST_TIMEOUT "${RADIO96_MEDIA_REQUEST_TIMEOUT:-5s}"
write_variable PRODUCTION_SHUTDOWN_TIMEOUT "${RADIO96_SHUTDOWN_TIMEOUT:-10s}"

mv "$environment_tmp" "$RADIO96_PRODUCTION_ENV_FILE"
trap - EXIT HUP INT TERM

echo "Production environment prepared for release $release_tag"
