// Forwards mail that SES received for info@ to one inbox.
// SES has already stored the message in S3 (inbound/<messageId>) and scanned it. This reads it,
// drops anything with a virus, flags suspected spam in the subject, and sends it on.
// How it's rewritten: rewrite.mjs.
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { rewrite } from './rewrite.mjs';

const s3 = new S3Client({});
const ses = new SESv2Client({});
const { BUCKET, PREFIX = 'inbound/', FROM_ADDRESS, FORWARD_TO } = process.env;
const MAX_RAW = 39 * 1024 * 1024; // (SES takes up to 40 MB, encoded)

export async function handler(event) {
  const rec = event.Records?.[0]?.ses;
  if (!rec) return;
  const { messageId } = rec.mail;
  const r = rec.receipt;
  const fail = (v) => v?.status === 'FAIL';
  if (fail(r.virusVerdict)) {
    console.log(JSON.stringify({ messageId, dropped: 'virus' }));
    return;
  }
  const flag = fail(r.spamVerdict) ? '[Suspected spam]' : fail(r.dmarcVerdict) ? '[Unverified sender]' : '';

  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: PREFIX + messageId }));
  const raw = Buffer.from(await obj.Body.transformToByteArray()).toString('binary');
  let data = Buffer.from(rewrite(raw, { from: FROM_ADDRESS, flag }), 'binary');

  if (data.length > MAX_RAW) {
    // Too big to send on: say so, and where it's kept (for 30 days).
    const subject = rec.mail.commonHeaders?.subject || '(no subject)';
    const sender = rec.mail.commonHeaders?.from?.join(', ') || rec.mail.source;
    data = Buffer.from([
      `From: "info" <${FROM_ADDRESS}>`, `To: ${FORWARD_TO}`, `Subject: Too big to forward: ${subject}`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '',
      `A message from ${sender} to ${FROM_ADDRESS} was ${Math.round(data.length / 1048576)} MB, too big to forward.`,
      `It's kept for 30 days in s3://${BUCKET}/${PREFIX}${messageId}.`, '',
    ].join('\r\n'));
  }

  await ses.send(new SendEmailCommand({
    FromEmailAddress: FROM_ADDRESS,
    Destination: { ToAddresses: [FORWARD_TO] },
    Content: { Raw: { Data: data } },
  }));
  console.log(JSON.stringify({ messageId, forwarded: true, flag: flag || undefined, bytes: data.length }));
}
