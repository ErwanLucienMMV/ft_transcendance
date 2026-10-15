#!/bin/sh
# Creates srcs/.env from .env.example, then generates every secret that is
# missing or empty (also in an older .env, e.g. one without JWT_SECRET).
# A value already set is never changed. Run through `make env`.
set -eu

dir=$(dirname "$0")
env_file="$dir/.env"

if [ ! -f "$env_file" ]; then
  cp "$dir/.env.example" "$env_file"
  echo "Created $env_file from .env.example"
fi

random() {
  od -An -tx1 -N32 /dev/urandom | tr -d ' \n'
}

# Sets KEY to VALUE when the line is missing or has no value.
fill() {
  key=$1
  value=$2
  if ! grep -q "^$key=" "$env_file"; then
    # Separate the new entry even when the existing file has no final newline.
    if [ -s "$env_file" ] && [ -n "$(tail -c 1 "$env_file")" ]; then
      printf '\n' >> "$env_file"
    fi
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
  elif grep -q "^$key=$" "$env_file"; then
    tmp="$env_file.tmp"
    awk -v key="$key" -v value="$value" \
      '$0 == key "=" { print key "=" value; next } { print }' \
      "$env_file" > "$tmp"
    mv "$tmp" "$env_file"
  else
    return 0
  fi
  echo "  $key generated in $env_file"
}

fill DATABASE_PASSWORD "$(random)"
fill POSTGRES_BACKUP_PASSWORD "$(random)"
fill JWT_SECRET "$(random)"
fill GF_SECURITY_ADMIN_USER admin
fill GF_SECURITY_ADMIN_PASSWORD "$(random)"
