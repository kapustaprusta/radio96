#!/bin/sh

set -eu

environment_file=${1:-.env.production}
if [ ! -f "$environment_file" ]; then
	echo "$environment_file is missing" >&2
	exit 1
fi

case "$environment_file" in
	*/*) ;;
	*) environment_file="./$environment_file" ;;
esac

# The production env file is operator-controlled and must use POSIX shell quoting.
# shellcheck disable=SC1090
. "$environment_file"

: "${PRODUCTION_PLATFORM:?PRODUCTION_PLATFORM is required}"
: "${PRODUCTION_IMAGE_PREFIX:?PRODUCTION_IMAGE_PREFIX is required}"
: "${PRODUCTION_RELEASE_TAG:?PRODUCTION_RELEASE_TAG is required}"

container_engine=${CONTAINER_ENGINE:-docker}
target_os=${PRODUCTION_PLATFORM%%/*}
target_arch=${PRODUCTION_PLATFORM#*/}
app_image="${PRODUCTION_IMAGE_PREFIX}/radio96-api:${PRODUCTION_RELEASE_TAG}"
web_image="${PRODUCTION_IMAGE_PREFIX}/radio96-web:${PRODUCTION_RELEASE_TAG}"
migrate_image="${PRODUCTION_IMAGE_PREFIX}/radio96-migrate:${PRODUCTION_RELEASE_TAG}"

if [ "$target_os" = "$PRODUCTION_PLATFORM" ] || [ "$target_arch" = "$PRODUCTION_PLATFORM" ]; then
	echo "PRODUCTION_PLATFORM must use the os/architecture format" >&2
	exit 1
fi

if [ "$target_os" != "linux" ]; then
	echo "PRODUCTION_PLATFORM must target Linux" >&2
	exit 1
fi

case "$target_arch" in
	amd64 | arm64)
		;;
	*)
		echo "PRODUCTION_PLATFORM must target amd64 or arm64" >&2
		exit 1
		;;
esac

"$container_engine" build \
	--platform "$PRODUCTION_PLATFORM" \
	--build-arg "TARGETOS=$target_os" \
	--build-arg "TARGETARCH=$target_arch" \
	--file deploy/Dockerfile \
	--tag "$app_image" \
	.

"$container_engine" build \
	--platform "$PRODUCTION_PLATFORM" \
	--file deploy/production/web.Dockerfile \
	--tag "$web_image" \
	.

"$container_engine" build \
	--platform "$PRODUCTION_PLATFORM" \
	--file deploy/production/migrate.Dockerfile \
	--tag "$migrate_image" \
	.
