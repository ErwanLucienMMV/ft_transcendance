#!/bin/sh
# Warns about srcs/.env settings that break the site at runtime (sign-in
# buttons, emails, links) with a message saying what to change. Never fails:
# run through `make env`, before every start.
dir=$(dirname "$0")
env_file="$dir/.env"
[ -f "$env_file" ] || exit 0

# Read KEY=value lines without executing the file; ${APPPORT} is expanded
# like Docker Compose does for APPURL.
value() {
  sed -n "s/^$1=//p" "$env_file" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}
appport=$(value APPPORT)
appurl=$(value APPURL | sed "s/\${APPPORT}/$appport/g; s/\$APPPORT/$appport/g")
public=$(value OAUTH_PUBLIC_URL)
[ -n "$public" ] || public=$appurl
public=${public%/}
warnings=0
warn() {
  warnings=$((warnings + 1))
  printf 'WARNING (srcs/.env): %s\n' "$1"
}

case "$appurl" in
  "") warn "APPURL is empty: email links and Google/GitHub sign-in cannot work." ;;
  https://localhost*|https://127.0.0.1*)
    warn "APPURL is $appurl: verification links in emails and OAuth only work on this machine. Set it to the address users type, e.g. https://my-server:$appport." ;;
  https://*) ;;
  *) warn "APPURL ($appurl) must start with https://, otherwise Google/GitHub sign-in stays disabled." ;;
esac

smtp_user=$(value SMTP_USER)
smtp_password=$(value SMTP_PASSWORD)
if [ -n "$smtp_user" ] && [ -z "$smtp_password" ]; then
  warn "SMTP_USER is set but SMTP_PASSWORD is empty: emails are only logged (docker logs forgemail), not sent."
elif [ -z "$smtp_user" ] && [ -n "$smtp_password" ]; then
  warn "SMTP_PASSWORD is set but SMTP_USER is empty: emails are only logged (docker logs forgemail), not sent."
elif [ -n "$smtp_user" ]; then
  [ -n "$(value MAIL_FROM)" ] || warn "MAIL_FROM is empty: emails are sent from $smtp_user."
  printf 'Emails are sent through %s:%s as %s. If registration answers "The verification email could not be sent", check the password (Gmail needs an app password) and `docker logs forgemail`.\n' \
    "$(value SMTP_HOST)" "$(value SMTP_PORT)" "$smtp_user"
fi

for provider in google github; do
  upper=$(printf '%s' "$provider" | tr a-z A-Z)
  id=$(value "${upper}_CLIENT_ID")
  [ -n "$id" ] || id=$(value "OAUTH_${upper}_CLIENT_ID")
  secret=$(value "${upper}_CLIENT_SECRET")
  [ -n "$secret" ] || secret=$(value "OAUTH_${upper}_CLIENT_SECRET")
  callback=$(value "${upper}_CALLBACK_URL")
  expected="$public/api/v1/auth/oauth/$provider/callback"
  if [ -z "$id" ] && [ -z "$secret" ]; then
    printf '%s sign-in is off (no %s_CLIENT_ID): its button is hidden.\n' "$provider" "$upper"
    continue
  fi
  [ -n "$id" ] || warn "${upper}_CLIENT_SECRET is set but ${upper}_CLIENT_ID is empty: the $provider button is hidden."
  [ -n "$secret" ] || warn "${upper}_CLIENT_ID is set but ${upper}_CLIENT_SECRET is empty: the $provider button is hidden."
  if [ -n "$callback" ] && [ "$callback" != "$expected" ]; then
    warn "${upper}_CALLBACK_URL is $callback but must be $expected (or empty): the $provider button is hidden."
  fi
done

if [ "$warnings" -gt 0 ]; then
  printf '%s warning(s): the stack still starts, fix srcs/.env then run make again.\n' "$warnings"
fi
exit 0
