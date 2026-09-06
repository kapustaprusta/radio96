#!/bin/sh

set -eu

fail() {
	echo "$1" >&2
	exit 1
}

require_command() {
	command -v "$1" >/dev/null 2>&1 || fail "required command is not available: $1"
}

escape_sed_replacement() {
	printf '%s' "$1" | sed 's/[&|\\]/\\&/g'
}

[ "$(id -u)" -eq 0 ] || fail "install-deployer.sh must run as root"
[ "$#" -eq 3 ] || fail "usage: install-deployer.sh CONFIG_FILE DEPLOY_USER REPOSITORY_DIR"

config_source=$1
deploy_user=$2
repository_dir=$3

require_command getent
require_command install
require_command runuser
require_command sed
require_command systemctl

case "$deploy_user" in
	'' | *[!A-Za-z0-9_-]*) fail "DEPLOY_USER is invalid" ;;
esac

getent passwd "$deploy_user" >/dev/null 2>&1 || fail "deployment user does not exist: $deploy_user"
deploy_group=$(id -gn "$deploy_user")
deploy_home=$(getent passwd "$deploy_user" | cut -d: -f6)
case "$deploy_home" in
	/*) ;;
	*) fail "deployment user has an invalid home directory" ;;
esac

case "$repository_dir" in
	/*) ;;
	*) fail "REPOSITORY_DIR must be an absolute path" ;;
esac
[ "$repository_dir" != "/" ] || fail "REPOSITORY_DIR cannot be the filesystem root"
[ -d "$repository_dir/.git" ] || fail "REPOSITORY_DIR is not a Git checkout: $repository_dir"
runuser -u "$deploy_user" -- test -w "$repository_dir" || fail "$deploy_user cannot write to REPOSITORY_DIR"
runuser -u "$deploy_user" -- test -w "$repository_dir/.git" || fail "$deploy_user cannot update the Git checkout"

case "$config_source" in
	/*) ;;
	*) config_source="$(pwd -P)/$config_source" ;;
esac
[ -r "$config_source" ] || fail "deployer configuration is not readable: $config_source"

service_template="$repository_dir/deploy/production/systemd/radio96-production-deploy.service.in"
timer_source="$repository_dir/deploy/production/systemd/radio96-production-deploy.timer"
deployer_script="$repository_dir/deploy/production/deploy-request.sh"
installed_deployer_script=/usr/local/libexec/radio96/deploy-request.sh

[ -r "$service_template" ] || fail "systemd service template is missing"
[ -r "$timer_source" ] || fail "systemd timer is missing"
[ -x "$deployer_script" ] || fail "production deployer is not executable"

if ! id -nG "$deploy_user" | tr ' ' '\n' | grep -qx docker; then
	fail "$deploy_user must belong to the docker group"
fi

deploy_path="${deploy_home}/yandex-cloud/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
runuser -u "$deploy_user" -- test -r "$config_source" || fail "$deploy_user cannot read CONFIG_FILE"
runuser -u "$deploy_user" -- \
	env HOME="$deploy_home" PATH="$deploy_path" \
	RADIO96_DEPLOYER_CONFIG="$config_source" \
	"$deployer_script" --check-config

escaped_user=$(escape_sed_replacement "$deploy_user")
escaped_group=$(escape_sed_replacement "$deploy_group")
escaped_home=$(escape_sed_replacement "$deploy_home")
escaped_path=$(escape_sed_replacement "$deploy_path")
escaped_repository=$(escape_sed_replacement "$repository_dir")

service_tmp=$(mktemp)
cleanup() {
	rm -f "$service_tmp"
}
trap cleanup EXIT HUP INT TERM

sed \
	-e "s|@DEPLOY_USER@|$escaped_user|g" \
	-e "s|@DEPLOY_GROUP@|$escaped_group|g" \
	-e "s|@DEPLOY_HOME@|$escaped_home|g" \
	-e "s|@DEPLOY_PATH@|$escaped_path|g" \
	-e "s|@REPOSITORY_DIR@|$escaped_repository|g" \
	"$service_template" >"$service_tmp"

install -d -m 0750 -o root -g "$deploy_group" /etc/radio96
install -m 0640 -o root -g "$deploy_group" "$config_source" /etc/radio96/deployer.env
install -d -m 0755 -o root -g root /usr/local/libexec/radio96
install -m 0755 -o root -g root "$deployer_script" "$installed_deployer_script"

runuser -u "$deploy_user" -- \
	env HOME="$deploy_home" PATH="$deploy_path" \
	RADIO96_DEPLOYER_CONFIG=/etc/radio96/deployer.env \
	"$installed_deployer_script" --check-config

install -m 0644 "$service_tmp" /etc/systemd/system/radio96-production-deploy.service
install -m 0644 "$timer_source" /etc/systemd/system/radio96-production-deploy.timer

systemctl daemon-reload
systemctl enable --now radio96-production-deploy.timer

echo "Production deployer installed for $deploy_user"
echo "Inspect it with: systemctl status radio96-production-deploy.timer"
echo "View deployment logs with: journalctl -u radio96-production-deploy.service"
