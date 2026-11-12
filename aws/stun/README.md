# VUEMesh's own STUN server

When two devices connect, each first asks a STUN server "what's my public address?" so they can find
a path to each other. Without this stack the site uses Google's (`stun.l.google.com`), and Google sees
each device's address. This stack runs one of our own at `stun.<domain>`.

- **STUN only** (coturn with `stun-only`): it answers that one question. It relays nothing (no TURN),
  so no video or sound ever passes through it, and it can't be used as a relay by anyone else.
- **No logs.** Addresses are answered and forgotten.
- **One Lightsail server** (Ubuntu 24.04, the smallest size with a public IPv4 address) with a fixed
  address and a DNS record. Security updates install by themselves (unattended-upgrades). SSH is open
  only to the Lightsail console's browser terminal.

## Cost

About **$5 a month** for the `nano_3_0` bundle at the time of writing (check `aws lightsail get-bundles`
for today's price). It includes far more data than STUN uses: each answer is under 100 bytes. The
static IP costs nothing while attached. It can't be a Lambda function: STUN is UDP, and Lambda only
answers HTTP.

## Deploy

```bash
./aws/stun/deploy.sh                    # makes the server and stun.vuemesh.com
node aws/stun/check.mjs stun.vuemesh.com
./aws/deploy.sh                         # finds the stack and writes it into the site's config.js
```

The deploy user needs Lightsail access (`lightsail:*` on its own instance and static IP) and Route 53
record changes in the domain's zone; `aws/iam-domain-policy.json` has the Route 53 part.

To stop paying: `aws cloudformation delete-stack --stack-name vuemesh-stun`, then deploy the site with
`STUN=google ./aws/deploy.sh` and put Google's STUN server back on the Privacy page.
