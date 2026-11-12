#!/usr/bin/env bash
# info@ for the domain, forwarded to an inbox you read, with replies sent as info@. See README.md.
#   FORWARD_TO=you@gmail.com ./aws/mail/deploy.sh
#   FORWARD_TO=you@gmail.com SMTP=1 ./aws/mail/deploy.sh   # also make the SMTP login for replying
# Needs: AWS CLI v2 (logged in), AWS SAM CLI, Node 20+.
set -euo pipefail
STACK="${STACK:-vuemesh-mail}"
REGION="${AWS_REGION:-us-east-2}"       # (us-east-1's receiving rules may already serve other domains)
DOMAIN="${DOMAIN:-vuemesh.com}"
ADDRESS="${ADDRESS:-info}"
RULESET="${RULESET:-vuemesh-mail}"
: "${FORWARD_TO:?Set FORWARD_TO to the inbox mail should go to}"
cd "$(dirname "$0")"

ZONE="${ZONE_ID:-$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" --query 'HostedZones[0].Id' --output text | sed 's|/hostedzone/||')}"

# Only one receipt rule set can be active per region. Don't take over one that's serving something else.
ACTIVE="$(aws ses describe-active-receipt-rule-set --region "$REGION" --query 'Metadata.Name' --output text 2>/dev/null || true)"
if [ -n "$ACTIVE" ] && [ "$ACTIVE" != "None" ] && [ "$ACTIVE" != "$RULESET" ]; then
  echo "SES in $REGION already has an active rule set ($ACTIVE). Use another AWS_REGION, or add a rule to that set." >&2
  exit 1
fi

echo "==> Deploying $STACK in $REGION ($ADDRESS@$DOMAIN → $FORWARD_TO)"
sam build --template template.yaml
sam deploy --stack-name "$STACK" --region "$REGION" --capabilities CAPABILITY_IAM --resolve-s3 \
  --no-confirm-changeset --no-fail-on-empty-changeset \
  --parameter-overrides "Domain=$DOMAIN" "Address=$ADDRESS" "ForwardTo=$FORWARD_TO" "HostedZoneId=$ZONE" "RuleSetName=$RULESET"

aws ses set-active-receipt-rule-set --rule-set-name "$RULESET" --region "$REGION"
echo "==> Receiving is on for $ADDRESS@$DOMAIN"

# While the account is in SES's sandbox, it can only send to verified addresses: the inbox has to be one.
if [ "$(aws sesv2 get-account --region "$REGION" --query ProductionAccessEnabled --output text)" != "True" ]; then
  if ! aws sesv2 get-email-identity --email-identity "$FORWARD_TO" --region "$REGION" >/dev/null 2>&1; then
    aws sesv2 create-email-identity --email-identity "$FORWARD_TO" --region "$REGION" >/dev/null
    echo "==> SES sent a verification link to $FORWARD_TO: click it, or forwarding is held back."
  fi
  echo "    (Still in the SES sandbox in $REGION: forwarding works; replying to anyone else needs production access. See README.md.)"
fi

if [ -n "${SMTP:-}" ]; then
  USER_NAME="$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" --query "Stacks[0].Outputs[?OutputKey=='SmtpUser'].OutputValue" --output text)"
  OUT="$(pwd)/.smtp-credentials"
  umask 077
  KEY_JSON="$(aws iam create-access-key --user-name "$USER_NAME" --output json)"
  # SES's SMTP password is derived from the secret key (AWS's published algorithm, version 4).
  node -e '
    const c = require("crypto"), k = JSON.parse(process.argv[1]).AccessKey, region = process.argv[2];
    const h = (key, msg) => c.createHmac("sha256", key).update(msg).digest();
    let s = h("AWS4" + k.SecretAccessKey, "11111111");
    for (const m of [region, "ses", "aws4_request", "SendRawEmail"]) s = h(s, m);
    const pass = Buffer.concat([Buffer.from([4]), s]).toString("base64");
    require("fs").writeFileSync(process.argv[3], [
      "# Gmail → Settings → Accounts → Send mail as → Add another email address",
      "# Name: whatever you like · Email: " + process.argv[4] + " · untick \"Treat as an alias\"",
      "SMTP server: email-smtp." + region + ".amazonaws.com",
      "Port: 587 (TLS)",
      "Username: " + k.AccessKeyId,
      "Password: " + pass,
      "", "# Keep this file private. Delete it once it is in Gmail; make a new one with SMTP=1.", ""].join("\n"), { mode: 0o600 });
  ' "$KEY_JSON" "$REGION" "$OUT" "$ADDRESS@$DOMAIN"
  echo "==> SMTP login for replying as $ADDRESS@$DOMAIN written to $OUT (private; not in git)"
fi
