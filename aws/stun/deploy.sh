#!/usr/bin/env bash
# VUEMesh's own STUN and TURN server, stun.<domain>. See README.md.
#   ./aws/stun/deploy.sh            (then ./aws/deploy.sh, which finds it and puts it in the site)
# Needs: AWS CLI v2, logged in. Costs one small Lightsail server a month (see README.md).
set -euo pipefail
STACK="${STACK:-vuemesh-stun}"
REGION="${AWS_REGION:-us-east-2}"
DOMAIN="${DOMAIN:-vuemesh.com}"
cd "$(dirname "$0")"
ZONE="${ZONE_ID:-$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" --query 'HostedZones[0].Id' --output text | sed 's|/hostedzone/||')}"

# The secret TURN passwords are signed with. It lives only in aws/.turn-secret on this machine, the
# server and the API function (./aws/deploy.sh passes it on). First deploy makes one.
SECRET_FILE="$(cd .. && pwd)/.turn-secret"
if [ ! -s "$SECRET_FILE" ]; then
  umask 077
  head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n' > "$SECRET_FILE"
  echo "==> Made a TURN secret in aws/.turn-secret (keep that file private)"
fi
SECRET="$(tr -d '\n' < "$SECRET_FILE")"

echo "==> Deploying $STACK in $REGION (stun.$DOMAIN)"
aws cloudformation deploy --stack-name "$STACK" --region "$REGION" --template-file template.yaml \
  --no-fail-on-empty-changeset --parameter-overrides "Domain=$DOMAIN" "HostedZoneId=$ZONE" "TurnSecret=$SECRET"

IP="$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" --query "Stacks[0].Outputs[?OutputKey=='IpAddress'].OutputValue" --output text)"
echo "==> stun.$DOMAIN is $IP. The server installs coturn on first boot (a minute or two)."
echo "    Check it:  node aws/stun/check.mjs stun.$DOMAIN        (STUN, and TURN with aws/.turn-secret)"
echo "    Then run ./aws/deploy.sh so the site uses it."
