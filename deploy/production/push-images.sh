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

: "${PRODUCTION_IMAGE_PREFIX:?PRODUCTION_IMAGE_PREFIX is required}"
: "${PRODUCTION_RELEASE_TAG:?PRODUCTION_RELEASE_TAG is required}"

container_engine=${CONTAINER_ENGINE:-docker}

for image_name in radio96-api radio96-web radio96-migrate; do
	image="${PRODUCTION_IMAGE_PREFIX}/${image_name}:${PRODUCTION_RELEASE_TAG}"

	if ! "$container_engine" image inspect "$image" >/dev/null 2>&1; then
		echo "production image is missing locally: $image" >&2
		exit 1
	fi

	"$container_engine" push "$image"
done
