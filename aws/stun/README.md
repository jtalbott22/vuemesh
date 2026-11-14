# VUEMesh's own STUN and TURN server

When two devices connect, each first asks a STUN server "what's my public address?" so they can find
a path to each other. Without this stack the site uses Google's (`stun.l.google.com`), and Google sees
each device's address. This stack runs one of our own at `stun.<domain>`.

Most of the time that's enough: on the same network devices connect directly, and across the
internet most pairs can too. Some can't: a phone on mobile data behind its carrier's NAT, or a strict
office, school or hotel network. For those the same server is a **TURN relay**: the devices both
send to it, and it passes the media on.

- **STUN for everyone**, as before: it answers that one question.
- **TURN only with a password from the site's API** (`GET /api/ice`). coturn's `use-auth-secret`:
  the username is `<expiry>:<random id>` and the password an HMAC of it with a secret only the
  server and the API know (`aws/.turn-secret`), good for a day. Nothing about who asked is in it.
  Without one it relays nothing, so it isn't an open relay. `vm.js` fetches it where `config.js`
  says the site has a relay (`turn: true`), and adds it to every new connection's ICE servers.
- **It can't read what it relays.** WebRTC media is encrypted end to end (DTLS-SRTP) between the two
  devices; the relay forwards packets it has no keys for.
- **A direct path always wins.** Browsers only use the relay when nothing else works, so a show on
  one network never touches it.
- **Only to the public internet.** It refuses to relay to private, loopback, link-local and
  reserved addresses (`denied-peer-ip`), the cloud's metadata service (`169.254.169.254`) among them,
  however they're written: IPv4 written as IPv6 (`::ffff:127.0.0.1`) too, which coturn before
  4.9.0 let past the IPv4 rules (CVE-2026-27624; Ubuntu 24.04 has 4.6.1).
- **UDP relays only** (`no-tcp-relay`): browsers never ask for a TCP relay, and a TCP relay is how a
  TURN server gets used to reach other machines' web pages, databases and the like.
- **Not to itself.** The server's own firewall (nftables, table `vuemesh`) lets the relay reach the
  server's own address only on its relay ports, where two relayed devices meet, never its STUN/TURN
  port or anything else on it.
- **Floods dropped:** a source opening more than 20 new flows a second to 3478 (an allocation flood,
  or spoofed requests meant to bounce answers at someone else) is dropped past a burst of 40.
- **Limits:** 12 relays per password, 400 in all, 5 Mbit/s each (a relayed camera on air uses 2.5)
  and 50 Mbit/s for the whole server (`user-quota`, `total-quota`, `max-bps`, `bps-capacity`), on
  UDP ports 49152–49999. At 50 Mbit/s flat out, a whole day is about half the month's data.

## Keeping it from being abused, with no accounts

A browser has to be given the password to use the relay, so anyone who opens the site, or a script
that asks the way a browser does, can get one: without accounts there is no keeping it from a
determined person (and accounts would only move the problem to sign-ups). So a password is made to
be worth little, and the whole relay is bounded:

- **Only this site's pages get one.** `/api/ice` answers only requests from the site's own pages
  (the browser's `Origin`, which a page can't change), so another site can't put its visitors on
  our relay. A script can send any `Origin`; the rest is for that.
- **A few an hour per address** (30, and 3,000 an hour for everyone), counted under a mark made from
  the address with the day's random salt (as the visitor count is), deleted after the hour. A script
  can't collect thousands of passwords, and each one only gets 12 relays at 5 Mbit/s.
- **A monthly budget.** New passwords stop at 90% of the month's data allowance, and at 100% the
  relay switches itself off (its UDP ports closed in Lightsail's firewall, which stops relays already
  going too; STUN keeps working). A small function checks every 15 minutes (`RelayGuardFunction`),
  and the API checks too when it's asked for a password. **Admin → Servers** switches it back on.
- **Watched in Admin → Servers:** each Lightsail server's state, failed status checks, the month's
  data against the allowance, the last day's data hour by hour, the processor and burst capacity,
  and how many passwords were given or refused (too many from one address, another site or a
  script, the relay off), all from Lightsail's own numbers and the anonymous day counts. And the
  relay's own counts (below): what share of connections needed it, relays started, the most open at
  once and hour by hour, relay hours, data through its ports, and what it turned away (wrong or
  expired passwords, private addresses, TCP relays, floods dropped, its own ports, full).
- **Kept up to date:** unattended-upgrades installs Ubuntu's security fixes for coturn and OpenSSL.
  `check.mjs` (below) tries every way round the rules this file lists.
- **No logs, only counts.** coturn's log (`verbose`, a line for each request) goes to
  `vuemesh-turn-count` on stdout, which counts what it's looking for (relays started, wrong or
  expired passwords, error 403 for a private address, 442 for a TCP relay, 486/508 full, other
  errors) and forgets the line. The firewall counts floods dropped, the relay stopped from reaching
  the server's own ports, and bytes through the relay ports. Every minute `vuemesh-turn-report`
  (cron) sends what's new, and how many relays are open (`ss`), to `POST /api/relay/report`, signed
  with an HMAC-SHA256 of the TURN secret; a report that doesn't get through is added to the next.
  The API adds them to the day's anonymous counts (`relay:*`, and `relayh:<hour>:*` for the last
  day by hour). No addresses leave the server, and none are written down.
- **Each browser counts its connections:** once a connection is up, the page sends one anonymous
  count of how it went (`route:<call|cam|tv|view>:<lan|direct|relay>`, with the page views, so not
  when the browser asks not to be tracked). That's what says how often the relay is needed at all.
- **A troubleshooting log, off by default.** Admin → Servers can switch on the relay's own log for
  an hour or a day (never longer; the API refuses more, and the server ignores more). The next
  minute's report brings the time back to the server (`/run/vuemesh/log-until`), and the counter
  writes the lines to `/run/vuemesh/turn.log`: memory only, readable only by root, 20 MB at most,
  deleted when the time's up, the switch goes off, or coturn restarts. It has the addresses of the
  devices relayed, which is the point: read it in the Lightsail console's browser terminal with
  `sudo tail -f /run/vuemesh/turn.log`. The Privacy page says so.
- **One Lightsail server** (Ubuntu 24.04, the smallest size with a public IPv4 address) with a fixed
  address and a DNS record. Security updates install by themselves (unattended-upgrades). SSH is open
  only to the Lightsail console's browser terminal. Lightsail puts it behind a one-to-one NAT, so a
  small script (`/usr/local/sbin/vuemesh-turn-config`, every minute from cron) writes coturn's
  `external-ip` from `stun.<domain>` and the server's private address, and restarts coturn when they
  change.

## Cost

About **$5 a month** for the `nano_3_0` bundle at the time of writing (check `aws lightsail get-bundles`
for today's price, and the data allowance that comes with it). STUN uses next to nothing: each answer
is under 100 bytes. **The relay uses the allowance:** a relayed camera or call passes through twice
(in and out), so one at about 2.5 Mbit/s is roughly 2 GB an hour. Only connections that can't be made
any other way are relayed. Past the allowance Lightsail charges per GB, so if the relay gets busy,
watch Admin → Servers and size it up. The relay switches itself off before the allowance runs out
(above), so the bill can't run away.
The static IP costs nothing while attached. It can't be a Lambda function: STUN and TURN are UDP,
and Lambda only answers HTTP.

## Deploy

```bash
./aws/stun/deploy.sh                    # makes the server, stun.vuemesh.com and aws/.turn-secret
node aws/stun/check.mjs stun.vuemesh.com
./aws/deploy.sh                         # finds the stack, gives the API the secret, writes config.js
```

`check.mjs` asks for this computer's address (STUN) and, with `aws/.turn-secret` here, gets a relay
with a password made the way the API makes it, and checks that a wrong password is refused; that
nothing private can be relayed to, by any spelling (`169.254.169.254`, `127.0.0.1`, `10.x`,
`0.0.0.0`, `::1`, `::ffff:127.0.0.1` …); that there are no TCP relays; that two relays on the server
reach each other; and that a relay can't reach the server's own STUN/TURN port. Then it lets the
relays go.

A minute or two later, Admin → Servers shows what `check.mjs` was turned away for (a wrong password,
the private addresses, a TCP relay) under the relay's counts: that's the check that the counter
reads coturn's log. If they stay at 0, coturn's wording may have changed: switch on the
troubleshooting log for an hour, run `check.mjs` again, and match the patterns in
`vuemesh-turn-count` (`template.yaml`) to its lines. The server's reports need the API from 0.77.0
(`./aws/deploy.sh`); until it's there, they wait and are sent together.

**Keep `aws/.turn-secret` private** (it's in `.gitignore`, like `aws/.admin-keys`). Both deploys need
it: on another machine, copy it over first.

**The server reads its start-up script (`UserData`, with the secret in it) only on its first boot.**
CloudFormation changes it on the running server without running it again, so a change there, or a
new secret, does nothing until there's a new server: bump the number in `InstanceName`
(`vuemesh-stun-4` → `-5`) in the same deploy. That makes a new server and moves the static IP to it
(same address; a minute or two without STUN or TURN while it starts). To change the secret: delete
`aws/.turn-secret`, bump the name, and run both deploys.

The deploy user needs Lightsail access (`lightsail:*` on its own instance and static IP) and Route 53
record changes in the domain's zone; `aws/iam-domain-policy.json` has the Route 53 part.

To stop paying: `aws cloudformation delete-stack --stack-name vuemesh-stun`, then deploy the site with
`STUN=google ./aws/deploy.sh` (Google's STUN, no relay) and put Google's STUN server back on the
Privacy page.
