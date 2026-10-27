#!/usr/bin/env bash
# Read provider credentials interactively; never print them or overwrite existing values.
set -euo pipefail
umask 077

case "${1:-}" in
  google) provider=google; prefix=GOOGLE ;;
  github) provider=github; prefix=GITHUB ;;
  *) printf 'Usage: bash srcs/configure-oauth-local.sh google|github\n' >&2; exit 2 ;;
esac

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
env_file="$script_dir/.env.oauth.local"
if [[ -L "$env_file" || ( -e "$env_file" && ! -f "$env_file" ) ]]; then
  printf 'Refusing to write an OAuth configuration symlink or non-regular file.\n' >&2
  exit 1
fi
if [[ -f "$env_file" ]]; then
  if ! rg -q '^OAUTH_PUBLIC_URL=http://localhost:4200$' "$env_file"; then
    printf 'Existing configuration uses a different origin; review it manually. Nothing changed.\n' >&2
    exit 1
  fi
  if rg -q "^${prefix}_CLIENT_(ID|SECRET)=" "$env_file"; then
    printf '%s credentials already have entries. Nothing was overwritten.\n' "$prefix" >&2
    exit 1
  fi
fi

IFS= read -r -p "$prefix Client ID: " client_id
IFS= read -r -s -p "$prefix Client secret (hidden input): " client_secret
printf '\n'
# These vendor credentials use ASCII identifier characters. Reject dotenv interpolation,
# quotes, whitespace and control characters instead of interpreting user input as code.
if [[ ! "$client_id" =~ ^[A-Za-z0-9._-]+$ || ! "$client_secret" =~ ^[A-Za-z0-9._-]+$ ]]; then
  printf 'Empty or unexpected credential characters. No configuration was written.\n' >&2
  exit 1
fi

if [[ ! -e "$env_file" ]]; then
  (set -o noclobber; printf '# Private local OAuth settings; ignored by Git.\nAPPURL=http://localhost:4200\nOAUTH_PUBLIC_URL=http://localhost:4200\n' > "$env_file")
fi
chmod 600 "$env_file"
printf '\n%s_CLIENT_ID=%s\n%s_CLIENT_SECRET=%s\n%s_CALLBACK_URL=http://localhost:4200/api/v1/auth/oauth/%s/callback\n' \
  "$prefix" "$client_id" "$prefix" "$client_secret" "$prefix" "$provider" >> "$env_file"
unset client_secret client_id
printf '%s configured in %s (credentials not displayed).\n' "$prefix" "$env_file"
