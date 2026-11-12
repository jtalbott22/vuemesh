# info@ for the domain

Mail to `info@vuemesh.com` is received by Amazon SES, forwarded to an inbox you already read
(Gmail, say), and answered from that inbox **as** info@vuemesh.com. No mail server to run, no
mailbox to pay for: it costs cents a month.

```text
someone ──▶ MX: inbound-smtp.us-east-2 ──▶ SES: spam + virus scan
                                              ├─▶ S3: kept encrypted, deleted after 30 days
                                              └─▶ Lambda (forward.mjs) ──▶ SES ──▶ your inbox
you reply in Gmail as info@ ──▶ SES SMTP (DKIM-signed, SPF/DMARC aligned) ──▶ them
```

- **Only info@ is accepted.** Mail to any other address at the domain is turned away.
- **A virus means it's dropped.** Suspected spam, or a sender that fails DMARC, arrives with
  `[Suspected spam]` or `[Unverified sender]` in the subject.
- **It arrives from info@**, named `"Their Name via info"`, with Reply-To set to them, so Reply
  answers them. (A forwarder can't send as someone else's address: Gmail would reject it.)
- **Over 39 MB** isn't forwarded; you get a note saying where it's kept.
- **The domain's records:** MX, SPF (`include:amazonses.com`), DKIM (three CNAMEs, 2048-bit),
  a MAIL FROM of `mail.vuemesh.com`, and DMARC `p=quarantine`, all made by the stack.
- **Its own stack** (`vuemesh-mail`, us-east-2), apart from the app's. us-east-1 isn't used because
  only one receiving rule set can be active per region, and it may already serve other domains.

## Set it up

```bash
FORWARD_TO=you@gmail.com ./aws/mail/deploy.sh
```

Then:

1. **Click the link SES emails to `FORWARD_TO`.** While the account is in SES's *sandbox* it can
   only send to verified addresses, so nothing is forwarded until you do. (Mail that comes in
   before then is still in the bucket for 30 days.)
2. **Ask for SES production access** in us-east-2, so replies can go to anyone: AWS console →
   Amazon SES (region **US East (Ohio)**) → *Get set up* → *Request production access*. Mail type:
   Transactional. Use case, for example: "Replies to messages people send to info@vuemesh.com, the
   contact address for an open-source project. Low volume, one person, no marketing or lists."
   Usually answered within a day.
3. **Reply as info@ from Gmail.** Make the SMTP login (it's an AWS access key for a user that can
   only send as info@, turned into SES's SMTP password and written to the private file
   `aws/mail/.smtp-credentials`, which git ignores):

   ```bash
   FORWARD_TO=you@gmail.com SMTP=1 ./aws/mail/deploy.sh
   ```

   Gmail → Settings → *Accounts and Import* → *Send mail as* → *Add another email address*: the
   address info@vuemesh.com, untick *Treat as an alias*, then the server, port, username and password
   from the file. Gmail sends a confirmation code to info@, which arrives in your inbox through
   the forwarder. Then delete the file. Also tick *Reply from the same address the message was sent
   to*, so replies to info@ go out as info@.

## Cost

SES receiving is $0.10 per 1,000 messages plus $0.09 per 1,000 256 KB chunks; sending is about $0.10
per 1,000. Lambda stays in the free tier and the bucket holds 30 days of mail. A few hundred messages a
month is a few cents.

## Checking on it

```bash
aws logs tail /aws/lambda/$(aws cloudformation describe-stack-resource --stack-name vuemesh-mail \
  --region us-east-2 --logical-resource-id Forwarder --query StackResourceDetail.PhysicalResourceId --output text) \
  --region us-east-2 --since 1h
```

Each message logs one line: its ID, whether it was forwarded, and any flag. Nothing else about it.

## Running your own copy

`DOMAIN`, `ADDRESS` (the part before the @), `AWS_REGION` and `FORWARD_TO` are all settings; the
domain needs a Route 53 hosted zone. The rewriting is in `functions/rewrite.mjs`, tested by
`test/mail.test.mjs`.
