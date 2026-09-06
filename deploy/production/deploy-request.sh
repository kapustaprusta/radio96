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

validate_sha() {
	sha=$1

	[ "${#sha}" -eq 40 ] || fail "deployment request contains an invalid Git commit SHA"
	case "$sha" in
		*[!0-9a-f]*) fail "deployment request contains an invalid Git commit SHA" ;;
	esac
}

github_get() {
	github_path=$1

	"$curl_bin" --fail --silent --show-error \
		--proto '=https' \
		--max-time 20 \
		--retry 2 \
		--header "Accept: application/vnd.github+json" \
		--header "X-GitHub-Api-Version: 2022-11-28" \
		--header "User-Agent: radio96-production-deployer" \
		"https://api.github.com/repos/${RADIO96_GITHUB_REPOSITORY}/${github_path}"
}

request_is_active() {
	request_json=$(github_get "actions/runs/$run_id")

	# shellcheck disable=SC2016
	printf '%s\n' "$request_json" | "$jq_bin" --exit-status \
		--arg run_id "$run_id" \
		--arg release_sha "$release_sha" \
		--arg repository "$RADIO96_GITHUB_REPOSITORY" \
		'(.id | tostring) == $run_id and
		 .status == "in_progress" and
		 .event == "workflow_dispatch" and
		 .head_branch == "main" and
		 .head_sha == $release_sha and
		 .head_repository.full_name == $repository' >/dev/null
}

site_runs_release() {
	deployed_release=$("$curl_bin" --fail --silent --show-error \
		--proto '=https' --max-time 5 "${site_url}/versionz" 2>/dev/null || true)

	[ "$deployed_release" = "$release_sha" ] || return 1
	"$curl_bin" --fail --silent --show-error \
		--proto '=https' --max-time 5 "${site_url}/readyz" >/dev/null 2>&1
}

write_state() {
	state_path=$1
	state_value=$2
	state_tmp=$(mktemp "${state_path}.tmp.XXXXXX")

	printf '%s\n' "$state_value" >"$state_tmp"
	chmod 600 "$state_tmp"
	mv "$state_tmp" "$state_path"
}

config_file=${RADIO96_DEPLOYER_CONFIG:-/etc/radio96/deployer.env}
case "$config_file" in
	*/*) ;;
	*) config_file="./$config_file" ;;
esac

[ -r "$config_file" ] || fail "deployer configuration is not readable: $config_file"

# The deployer configuration is installed root-owned and contains metadata only.
# shellcheck disable=SC1090
. "$config_file"

: "${RADIO96_GITHUB_REPOSITORY:?RADIO96_GITHUB_REPOSITORY is required}"
: "${RADIO96_GITHUB_WORKFLOW:?RADIO96_GITHUB_WORKFLOW is required}"
: "${RADIO96_REPOSITORY_DIR:?RADIO96_REPOSITORY_DIR is required}"
: "${RADIO96_PRODUCTION_ENV_FILE:?RADIO96_PRODUCTION_ENV_FILE is required}"
: "${RADIO96_DEPLOYER_STATE_DIR:?RADIO96_DEPLOYER_STATE_DIR is required}"
: "${RADIO96_SITE_URL:?RADIO96_SITE_URL is required}"

require_absolute_path RADIO96_REPOSITORY_DIR "$RADIO96_REPOSITORY_DIR"
require_absolute_path RADIO96_PRODUCTION_ENV_FILE "$RADIO96_PRODUCTION_ENV_FILE"
require_absolute_path RADIO96_DEPLOYER_STATE_DIR "$RADIO96_DEPLOYER_STATE_DIR"

case "$RADIO96_GITHUB_REPOSITORY" in
	/* | */ | */*/* | *[!A-Za-z0-9._/-]*) fail "RADIO96_GITHUB_REPOSITORY must use the owner/repository format" ;;
	*/*) ;;
	*) fail "RADIO96_GITHUB_REPOSITORY must use the owner/repository format" ;;
esac

case "$RADIO96_GITHUB_WORKFLOW" in
	'' | *[!A-Za-z0-9._-]*) fail "RADIO96_GITHUB_WORKFLOW must be a workflow file name" ;;
esac

case "$RADIO96_SITE_URL" in
	https://*) ;;
	*) fail "RADIO96_SITE_URL must use https" ;;
esac
site_url=${RADIO96_SITE_URL%/}

curl_bin=${RADIO96_CURL_BIN:-curl}
jq_bin=${RADIO96_JQ_BIN:-jq}
git_bin=${RADIO96_GIT_BIN:-git}
flock_bin=${RADIO96_FLOCK_BIN:-flock}
make_bin=${RADIO96_MAKE_BIN:-make}
docker_bin=${RADIO96_DOCKER_BIN:-docker}

require_command "$curl_bin"
require_command "$jq_bin"
require_command "$git_bin"
require_command "$flock_bin"
require_command "$make_bin"
require_command "$docker_bin"

render_script="$RADIO96_REPOSITORY_DIR/deploy/production/render-env.sh"
[ -x "$render_script" ] || fail "production environment renderer is not executable: $render_script"

RADIO96_DEPLOYER_CONFIG="$config_file" "$render_script" --check-config >/dev/null

if [ "${1:-}" = "--check-config" ]; then
	echo "Production deployer configuration is valid"
	exit 0
fi
[ "$#" -eq 0 ] || fail "usage: deploy-request.sh [--check-config]"

mkdir -p "$RADIO96_DEPLOYER_STATE_DIR"
chmod 700 "$RADIO96_DEPLOYER_STATE_DIR"
exec 9>"$RADIO96_DEPLOYER_STATE_DIR/deploy.lock"
if ! "$flock_bin" -n 9; then
	echo "Another production deployment is already running"
	exit 0
fi

runs_json=$(github_get \
	"actions/workflows/${RADIO96_GITHUB_WORKFLOW}/runs?branch=main&event=workflow_dispatch&per_page=5")
# shellcheck disable=SC2016
selected_run=$(printf '%s\n' "$runs_json" | "$jq_bin" --compact-output \
	--arg repository "$RADIO96_GITHUB_REPOSITORY" \
	'[.workflow_runs[] |
	  select(.status == "in_progress" and
	         .event == "workflow_dispatch" and
	         .head_branch == "main" and
	         .head_repository.full_name == $repository)][0] // empty')

if [ -z "$selected_run" ]; then
	exit 0
fi

run_id=$(printf '%s\n' "$selected_run" | "$jq_bin" --raw-output '.id')
release_sha=$(printf '%s\n' "$selected_run" | "$jq_bin" --raw-output '.head_sha')

case "$run_id" in
	'' | *[!0-9]*) fail "deployment request contains an invalid workflow run ID" ;;
esac
validate_sha "$release_sha"

last_request_file="$RADIO96_DEPLOYER_STATE_DIR/last-request"
current_release_file="$RADIO96_DEPLOYER_STATE_DIR/current-release"
if ! request_is_active; then
	echo "Deployment request $run_id is no longer active"
	exit 0
fi

if site_runs_release; then
	write_state "$current_release_file" "$release_sha"
	write_state "$last_request_file" "$run_id"
	echo "Production already runs release $release_sha"
	exit 0
fi

[ -d "$RADIO96_REPOSITORY_DIR/.git" ] || fail "deployment repository is not a Git checkout"

expected_ssh_remote="git@github.com:${RADIO96_GITHUB_REPOSITORY}.git"
expected_ssh_remote_without_suffix="git@github.com:${RADIO96_GITHUB_REPOSITORY}"
expected_https_remote="https://github.com/${RADIO96_GITHUB_REPOSITORY}.git"
expected_https_remote_without_suffix="https://github.com/${RADIO96_GITHUB_REPOSITORY}"
origin_url=$("$git_bin" -C "$RADIO96_REPOSITORY_DIR" remote get-url origin)
case "$origin_url" in
	"$expected_ssh_remote" | "$expected_ssh_remote_without_suffix" | \
		"$expected_https_remote" | "$expected_https_remote_without_suffix") ;;
	*) fail "deployment repository origin does not match RADIO96_GITHUB_REPOSITORY" ;;
esac

if ! "$git_bin" -C "$RADIO96_REPOSITORY_DIR" diff --quiet --ignore-submodules --; then
	fail "deployment repository has tracked working tree changes"
fi
if ! "$git_bin" -C "$RADIO96_REPOSITORY_DIR" diff --cached --quiet --ignore-submodules --; then
	fail "deployment repository has staged changes"
fi

echo "Preparing production release $release_sha from workflow run $run_id"
"$git_bin" -C "$RADIO96_REPOSITORY_DIR" fetch --quiet origin main
"$git_bin" -C "$RADIO96_REPOSITORY_DIR" cat-file -e "${release_sha}^{commit}"
if ! "$git_bin" -C "$RADIO96_REPOSITORY_DIR" merge-base --is-ancestor "$release_sha" origin/main; then
	fail "requested release is not an ancestor of origin/main"
fi

if ! request_is_active; then
	echo "Deployment request $run_id was cancelled before deployment"
	exit 0
fi

"$git_bin" -C "$RADIO96_REPOSITORY_DIR" switch --detach --force "$release_sha"

render_script="$RADIO96_REPOSITORY_DIR/deploy/production/render-env.sh"
[ -x "$render_script" ] || fail "target release does not contain the production environment renderer"
RADIO96_DEPLOYER_CONFIG="$config_file" "$render_script" "$release_sha"

if ! request_is_active; then
	echo "Deployment request $run_id was cancelled before containers were updated"
	exit 0
fi

"$make_bin" -C "$RADIO96_REPOSITORY_DIR" \
	"DOCKER_COMPOSE=$docker_bin compose" \
	"PRODUCTION_ENV_FILE=$RADIO96_PRODUCTION_ENV_FILE" \
	production-deploy

attempt=1
while [ "$attempt" -le 60 ]; do
	if site_runs_release; then
		write_state "$current_release_file" "$release_sha"
		write_state "$last_request_file" "$run_id"
		echo "Production deployment completed for release $release_sha"
		exit 0
	fi

	sleep 5
	attempt=$((attempt + 1))
done

fail "production did not become ready with release $release_sha within 5 minutes"
