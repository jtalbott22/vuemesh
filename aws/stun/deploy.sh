#!/usr/bin/env bash
# VUEMesh's own STUN server, stun.<domain>. See README.md.
#   ./aws/stun/deploy.sh            (then ./aws/deploy.sh, which finds it and puts it in config.js)
# Needs: AWS CLI v2, logged in. Costs one small Lightsail server a month (see README.md).
set -euo pipefail
STACK="${STACK:-vuemesh-stun}"
REGION="${AWS_REGION:-us-east-2}"
DOMAIN="${DOMAIN:-vuemesh.com}"
cd "$(dirname "$0")"
ZONE="${ZONE_ID:-$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" --query 'HostedZones[0].Id' --output text | sed 's|/hostedzone/||')}"

echo "==> Deploying $STACK in $REGION (stun.$DOMAIN)"
aws cloudformation deploy --stack-name "$STACK" --region "$REGION" --template-file template.yaml \
  --no-fail-on-empty-changeset --parameter-overrides "Domain=$DOMAIN" "HostedZoneId=$ZONE"

IP="$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" --query "Stacks[0].Outputs[?OutputKey=='IpAddress'].OutputValue" --output text)"
echo "==> stun.$DOMAIN is $IP. The server installs coturn on first boot (a minute or two)."
echo "    Check it:  node aws/stun/check.mjs stun.$DOMAIN"
echo "    Then run ./aws/deploy.sh so the site uses it."
