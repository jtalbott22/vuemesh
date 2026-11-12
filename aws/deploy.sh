#!/usr/bin/env bash
# Deploy VUEMesh to AWS: backend stack, then the site, then a cache refresh.
# Needs: AWS CLI v2 (logged in), AWS SAM CLI, Node 20+.
#   ./aws/deploy.sh                                   # CloudFront URL
#   DOMAIN=vuemesh.com CERT_ARN=arn:aws:acm:us-east-1:... ./aws/deploy.sh
set -euo pipefail
STACK="${STACK:-vuemesh}"
REGION="${AWS_REGION:-us-east-2}"
cd "$(dirname "$0")"

# Admin keys live only in aws/.admin-keys on this machine (one per line). AWS only
# ever sees their SHA-256 hashes. First deploy makes one for you.
KEYFILE="$(pwd)/.admin-keys"
if [ ! -s "$KEYFILE" ]; then
  umask 077
  head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n' > "$KEYFILE"
  echo >> "$KEYFILE"
  NEW_KEY=1
fi
HASHES="$(grep -v '^\s*$' "$KEYFILE" | while read -r k; do printf '%s' "$k" | sha256sum | cut -d' ' -f1; done | paste -sd, -)"

# Only pass domain settings when you actually set them (SAM rejects empty values).
PARAMS=(--parameter-overrides "AdminKeyHashes=$HASHES" "GlobeEnabled=${GLOBE:-false}" "PublishEnabled=${PUBLISH:-false}")
if [ -n "${DOMAIN:-}" ]; then
  if [ -z "${CERT_ARN:-}" ]; then
    echo "DOMAIN is set but CERT_ARN is not. Request the certificate in us-east-1 first (see aws/README.md)." >&2
    exit 1
  fi
  PARAMS+=("DomainName=$DOMAIN" "CertificateArn=$CERT_ARN")
fi
# Local shows' addresses and certificates (vuemesh-local.mjs): the domain's Route 53 zone. Needed once:
# like DOMAIN and CERT_ARN, it's only sent when set, and the stack keeps what it was given before.
if [ -n "${LAN_ZONE:-}" ]; then PARAMS+=("LanZoneId=$LAN_ZONE"); fi

echo "==> Building and deploying the backend stack ($STACK in $REGION)"
sam build --template template.yaml
sam deploy \
  --stack-name "$STACK" --region "$REGION" \
  --capabilities CAPABILITY_IAM --resolve-s3 \
  --no-confirm-changeset --no-fail-on-empty-changeset \
  ${PARAMS[@]+"${PARAMS[@]}"}

out() { aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
BUCKET="$(out BucketName)"; API="$(out ApiUrl)"; WS="$(out WsUrl)"; SITE="$(out SiteUrl)"; DIST="$(out DistributionId)"

echo "==> Keeping the functions' logs for 14 days (as the Privacy page says), not forever"
for fn in ApiFunction SignalFunction; do
  name="$(aws cloudformation describe-stack-resource --stack-name "$STACK" --region "$REGION" --logical-resource-id "$fn" --query StackResourceDetail.PhysicalResourceId --output text)"
  aws logs create-log-group --log-group-name "/aws/lambda/$name" --region "$REGION" 2>/dev/null || true
  aws logs put-retention-policy --log-group-name "/aws/lambda/$name" --retention-in-days 14 --region "$REGION"
done

echo "==> Uploading the site to s3://$BUCKET"
SITE_DIR="$(mktemp -d)"
cp -R ../public/. "$SITE_DIR/"
cp ../CHANGELOG.md "$SITE_DIR/changelog.md" # (the site's What's new page reads it: public/changelog.html)
echo "window.VM_CONFIG = { api: '$API', ws: '$WS' };" > "$SITE_DIR/config.js"
# For the local show helper (public/relay/vuemesh-local.mjs): the server's own code, and the list
# of the app's files it keeps a copy of (not the big landing-page films)
mkdir -p "$SITE_DIR/relay/lib"
cp functions/lib/core.mjs functions/lib/common.mjs functions/lib/store-memory.mjs "$SITE_DIR/relay/lib/"
node -e '
  const fs = require("fs"), path = require("path"), root = process.argv[1], out = [];
  const walk = (d) => { for (const n of fs.readdirSync(d)) { const f = path.join(d, n), r = path.relative(root, f).split(path.sep).join("/");
    if (fs.statSync(f).isDirectory()) { if (!["films", "relay"].includes(r)) walk(f); }
    else if (!/\.(mp4|webm|mov)$/i.test(n) && fs.statSync(f).size < 5e6 && r !== "config.js") out.push(r); } };
  walk(root); fs.writeFileSync(path.join(root, "app-files.json"), JSON.stringify({ files: out.sort() }));
' "$SITE_DIR"
# Assets: short cache. Published films live under films/ and are never touched.
aws s3 sync "$SITE_DIR/" "s3://$BUCKET/" --region "$REGION" --delete \
  --exclude "films/*" --exclude "*.html" --exclude "config.js" --exclude "sw.js" \
  --cache-control "public, max-age=300"
# Pages and config: always revalidate.
aws s3 sync "$SITE_DIR/" "s3://$BUCKET/" --region "$REGION" \
  --exclude "*" --include "*.html" --include "config.js" --include "sw.js" \
  --cache-control "no-cache"
for m in manifest remote; do
  aws s3 cp "$SITE_DIR/$m.webmanifest" "s3://$BUCKET/$m.webmanifest" --region "$REGION" \
    --content-type "application/manifest+json" --cache-control "public, max-age=300"
done
# Fonts (served from the site: no outside requests): the right type, cached for a year.
aws s3 cp "$SITE_DIR/fonts/" "s3://$BUCKET/fonts/" --region "$REGION" --recursive \
  --exclude "*" --include "*.woff2" --content-type "font/woff2" --cache-control "public, max-age=31536000, immutable"

echo "==> Refreshing CloudFront"
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" >/dev/null

cat <<DONE

VUEMesh is live at: $SITE
  API:        $API
  Signaling:  $WS
  Admin:      $SITE/admin
DONE
if [ -n "${NEW_KEY:-}" ]; then
  echo
  echo "Your admin key (also saved in aws/.admin-keys — keep that file private):"
  echo "  $(head -1 "$KEYFILE")"
fi
