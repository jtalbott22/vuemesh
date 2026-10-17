# Prompt for an AWS AI assistant

Use this with **Kiro** (AWS's agentic coding tool; `kiro-cli` in a terminal or the Kiro IDE) opened in this project folder. Amazon Q Developer is being retired (no new signups since May 2026), so Kiro is the current AWS option. Any coding agent that can run the AWS CLI also works. Fill in the two bracketed lines first (or delete them to use the CloudFront URL).

---

You are deploying an existing, finished project. Do not redesign it or add services.

**Project:** VUEMesh, a LAN-first multi-camera event app. Phones send video to a host laptop directly over the local network with WebRTC. The cloud only does event discovery, WebRTC signaling, and publishing a finished film. The code and infrastructure are already written:

- `aws/template.yaml` — AWS SAM template: DynamoDB (on-demand, TTL), S3 bucket with CloudFront (Origin Access Control, a CloudFront Function for clean URLs), an HTTP API + Lambda (`aws/functions/api.mjs`), and a WebSocket API + Lambda (`aws/functions/signal.mjs`). Node.js Lambdas on arm64.
- `aws/deploy.sh` — builds and deploys the stack, writes `config.js` with the API and WebSocket URLs, syncs `public/` to S3, and invalidates CloudFront.
- `public/` — the static web app. Do not edit it.

**Goal:** get the site live over HTTPS at the lowest possible cost.

**Settings:**
- Region: us-east-2
- Stack name: vuemesh
- [Custom domain: vuemesh.com]
- [DNS is hosted at: Route 53 / my registrar]

**Steps:**
1. Confirm the AWS CLI is authenticated (`aws sts get-caller-identity`) and that the AWS SAM CLI and Node.js 20+ are installed. Install SAM if it's missing, and tell me what you installed.
2. If a custom domain is set: request a public ACM certificate for it in **us-east-1** with DNS validation. If DNS is in Route 53, create the validation record; otherwise show me the exact CNAME record to add and wait until I confirm the certificate is Issued.
3. Run `./aws/deploy.sh` from the project root. If there's a custom domain, run it as `DOMAIN=<domain> CERT_ARN=<certificate ARN> ./aws/deploy.sh`.
4. If there's a custom domain in Route 53, create an A record (Alias) pointing to the CloudFront distribution from the stack output `CloudFrontDomain`. Otherwise tell me the record to create at my registrar.
5. Verify:
   - `curl -s -X POST <ApiUrl>/events -H 'content-type: application/json' -d '{"title":"Deploy check"}'` returns an `id` and `hostKey`.
   - `curl -s <ApiUrl>/events/<id>` returns the event.
   - The site URL loads `index.html`, and `<site>/cam` (no extension) loads the camera page.
6. Report back: the site URL, ApiUrl, WsUrl, the S3 bucket name, and anything that failed. The deploy prints a new admin key the first time; tell me it was created but do not paste it into the chat, and do not commit `aws/.admin-keys`.

**Constraints:**
- Do not add a TURN server, NAT gateway, load balancer, EC2 instance, VPC, or any always-on compute.
- Do not make the S3 bucket public. CloudFront reads it through Origin Access Control.
- Do not change the DynamoDB billing mode, the Lambda code, or `public/`.
- If a deploy step fails, show me the error and the CloudFormation event that caused it before changing anything.
