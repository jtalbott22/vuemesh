# Putting VUEMesh on AWS

The whole cloud side is one CloudFormation stack (`template.yaml`) plus the static site. Nothing runs when nobody is using it.

```
            the venue (does the real work)                         AWS (thin)
 ┌──────────────────────────────────────────────┐     ┌───────────────────────────────────┐
 │ phones ──WebRTC over local Wi-Fi──► host     │     │ CloudFront + S3   the app, films  │
 │   live previews + full clips        laptop   │     │ HTTP API + Lambda events, find,   │
 │ beacon screen (join link + clock)            │     │                   publish URLs    │
 └───────────────────┬──────────────────────────┘     │ WebSocket API +   "who's here" +  │
                     │  tiny handshake messages        │ Lambda            WebRTC handshakes│
                     └────────────────────────────────►│ DynamoDB          events, sockets │
                                                       └───────────────────────────────────┘
```

Video only reaches AWS once: when the host publishes the finished film.

## What it costs

- **Per request, scale to zero:** Lambda, API Gateway (HTTP + WebSocket), DynamoDB on-demand. An event with 50 phones is a few thousand small messages.
- **No TURN server.** A TURN server relays video when two devices can't reach each other directly, and you pay for every byte. VUEMesh skips it: phones join the venue Wi-Fi and connect straight to the host laptop. Discovery and handshakes (what you described as "act as a TURN or something") are signaling, which is cheap.
- **The one thing that grows with success** is people watching published films through CloudFront. CloudFront's always-free allowance is 1 TB of data out and 10 million requests per month.
- **S3** stores the site and published films only. Raw clips stay on the host laptop.
- **Our own STUN server** (`aws/stun`, optional): one small Lightsail server, about $5 a month, so devices ask us for their public address instead of Google. STUN is UDP, so it can't be a Lambda. See [stun/README.md](stun/README.md).

## One-time setup

1. **AWS account and CLI.** Install the AWS CLI v2 and run `aws configure sso` (or `aws configure` with an IAM user's keys). Use a user or role that can create CloudFormation stacks, IAM roles, Lambda, API Gateway, DynamoDB, S3 and CloudFront.
2. **SAM CLI.** Install the AWS SAM CLI (`brew install aws-sam-cli` on a Mac, or the installer from AWS on Windows/Linux).
3. **Node.js 20 or newer.**

## Deploy

From the project folder:

```bash
./aws/stun/deploy.sh   # once: the STUN server (or skip it and run the next line with STUN=google)
./aws/deploy.sh
```

It builds the Lambdas, deploys the stack to `us-east-2` (Ohio), uploads the site with a `config.js` pointing at your new API and WebSocket URLs, and refreshes CloudFront. The first run takes about 5–10 minutes, mostly CloudFront. It prints the site URL at the end.

Change the region with `AWS_REGION=us-east-1 ./aws/deploy.sh`, and the stack name with `STACK=vuemesh-dev`.

Run the same command again after any change. It only updates what changed.

## Admin key

The first deploy creates a random admin key in `aws/.admin-keys` (only on your computer, git-ignored) and prints it once. Sign in at `<site>/admin`. AWS only ever stores SHA-256 hashes of the keys.

- **Add a teammate:** put another key on a new line of `aws/.admin-keys` (any long random string), then run `./aws/deploy.sh`.
- **Remove someone:** delete their line and deploy again.

## Beta switches

Both are off unless you turn them on at deploy time, and the site has matching switches in `public/js/brand.js` (`FEATURES`):

- `PUBLISH=true ./aws/deploy.sh` lets hosts upload finished films (and set `publish: true` in `brand.js`).
- `GLOBE=true ./aws/deploy.sh` serves the public events map (and set `globe: true` in `brand.js`).

## Cleanup and cost control

Everything expires 30 days after an event is created. The API treats an expired event as gone immediately; DynamoDB's TTL deletes the record within a day or two; an S3 lifecycle rule deletes published films after 30 days and clears abandoned uploads after one. You can also delete anything sooner from the admin panel.

## Your own domain (vuemesh.com)

1. In **AWS Certificate Manager, in us-east-1** (CloudFront only uses certificates from that region), request a public certificate for `vuemesh.com` and choose DNS validation. Add the CNAME record it gives you at your DNS provider and wait for "Issued".
2. Deploy with the domain:
   ```bash
   DOMAIN=vuemesh.com CERT_ARN=arn:aws:acm:us-east-1:123456789012:certificate/... ./aws/deploy.sh
   ```
3. Point DNS at CloudFront. The stack output `CloudFrontDomain` is the target. With Route 53, create an A record (Alias) to that distribution. At other registrars, use an ALIAS/ANAME record for the bare domain, or a CNAME for `www`.

## Showing VUEMesh on a digital sign

Signage players (Rise Vision and the like) show a web page in a frame. Only `/kiosk`, `/studio` and `/tv` allow that: they get the stack's `EmbedHeaders` policy (`Content-Security-Policy: frame-ancestors *`). Every other page keeps CloudFront's managed security headers, which refuse framing by other sites. To let another page be framed, add a cache behaviour for its path in `template.yaml`.

## Local shows' addresses (vuemesh-local.mjs)

The local show helper (`public/relay/vuemesh-local.mjs`) runs a show on the studio computer's own Wi-Fi, at an https address like `abc123defg.lan.vuemesh.com`. Phones need nothing installed because that address has a real certificate from Let's Encrypt. To get one, the helper registers its name with the API (with a host key), and the API puts the record Let's Encrypt checks into the domain's DNS (only that record, only for that name's owner). Turn it on by giving the deploy the domain's Route 53 hosted zone:

```bash
LAN_ZONE=Z0123456789EXAMPLE DOMAIN=vuemesh.com CERT_ARN=... ./aws/deploy.sh
```

The API function then gets permission to change records in that one zone, and nothing else. Without `LAN_ZONE`, the helper still runs, but can't get a certificate. Let's Encrypt allows 50 new names a week for a domain; renewals don't count against that.

`LAN_ZONE` is needed **once**. The stack keeps it, and a later `./aws/deploy.sh` without it leaves it as it is, as with `DOMAIN` and `CERT_ARN` (the deploy only sends those when they're set). `GLOBE` and `PUBLISH` are different: the deploy sends them every time, so they go back to `false` unless you set them. To find the zone, or check what the stack has:

```bash
aws route53 list-hosted-zones --query "HostedZones[?Name=='vuemesh.com.'].Id" --output text
aws cloudformation describe-stacks --stack-name vuemesh --region us-east-2 --query "Stacks[0].Parameters[?ParameterKey=='LanZoneId'].ParameterValue" --output text
```

The deploy also publishes the server's own code (`relay/lib/`) and a list of the app's files (`app-files.json`), which the helper keeps copies of for the shows it runs with no internet.

## Check it works

1. Open the site URL on a laptop, start an event, open **the studio** (keep it on the laptop) and **the beacon** (a second screen on the same laptop is ideal, so live cuts and clips share one clock).
2. On the beacon, tap **Venue Wi-Fi** and enter the network name and password. The beacon shows a Wi-Fi code guests scan first.
3. Phones join the Wi-Fi, scan the beacon, and appear in the studio's Live view with a green **LAN** badge. An amber **Internet** badge means that phone isn't on the same network.
4. Cut live with 1–9, record a clip on each phone, and watch clips arrive and verify in the studio. Switch to **Edit**, press **Publish**, and open the watch link.

## If phones can't reach the host

- **Campus and hotel Wi-Fi usually block devices from talking to each other** ("client isolation"). Bring a small travel router, plug or tether it to the internet, and have everyone join that network. This is the fix 9 times out of 10.
- Phones on cellular can often still connect over the internet (amber badge), but carrier networks frequently block it. Their clips stay safely on the phone and send when they join the Wi-Fi, and guests can always tap **Save** to keep a copy.
- If you ever need to reach people who can't be on the local network, add a TURN server (for example, coturn on a small EC2 instance) and list it in `config.js` as `iceServers`. That's the point where video starts costing you bandwidth.

## Tear it down

```bash
aws s3 rm s3://<BucketName> --recursive
sam delete --stack-name vuemesh --region us-east-2
```

## Files

| File | Purpose |
| --- | --- |
| `template.yaml` | Everything above as one SAM/CloudFormation stack |
| `functions/api.mjs` | HTTP API Lambda: create, look up, find nearby, publish |
| `functions/signal.mjs` | WebSocket Lambda: presence and WebRTC handshakes |
| `functions/lib/core.mjs` | The logic both Lambdas share (also runs in the local dev server) |
| `functions/lib/store-dynamo.mjs` | DynamoDB single-table layout, with TTL cleanup |
| `deploy.sh` | Build, deploy, upload site, refresh cache |
| `iam-deploy-policy.json` | Scoped IAM policy for the person or agent running the deploy (replace `ACCOUNT_ID`) |
| `iam-domain-policy.json` | Optional add-on for ACM and Route 53 when you attach vuemesh.com |
| `PROMPT.md` | A prompt for having AWS's AI assistant do the deployment for you |

## Email (info@)

The domain's contact address is a separate, optional stack: see [mail/README.md](mail/README.md).
