// info@'s forwarder (aws/mail): how a received message is rewritten before it's sent on.
import assert from 'node:assert/strict';
import { rewrite, displayName, splitMessage } from '../aws/mail/functions/rewrite.mjs';

const raw = [
  'Return-Path: <ana@x.com>', 'DKIM-Signature: v=1; a=rsa-sha256;', ' b=abc', 'From: "Ana Ruiz" <ana@x.com>',
  'To: info@vuemesh.com', 'Subject: Hello', 'Message-ID: <1@x>', 'ARC-Seal: i=1', 'Content-Type: text/plain', '',
  'Hi there', '', 'From the body: not a header',
].join('\r\n');

{
  const { headers, body } = splitMessage(raw);
  assert.equal(headers.length, 8);
  assert.equal(headers[1], 'DKIM-Signature: v=1; a=rsa-sha256;\r\n b=abc');
  assert.equal(body, 'Hi there\r\n\r\nFrom the body: not a header');
  console.log('ok  a message splits into headers (folded lines kept together) and the body, untouched');
}

{
  const out = rewrite(raw, { from: 'info@vuemesh.com' });
  const [head, ...rest] = out.split('\r\n\r\n');
  const h = head.split('\r\n');
  assert.equal(h[0], 'From: "Ana Ruiz via info" <info@vuemesh.com>');
  assert.ok(h.includes('Reply-To: "Ana Ruiz" <ana@x.com>'));
  assert.ok(h.includes('Subject: Hello') && h.includes('To: info@vuemesh.com') && h.includes('Content-Type: text/plain'));
  for (const gone of ['Return-Path', 'DKIM-Signature', 'Message-ID', 'ARC-Seal', ' b=abc']) assert.ok(!head.includes(gone), gone);
  assert.equal(rest.join('\r\n\r\n'), 'Hi there\r\n\r\nFrom the body: not a header');
  console.log('ok  forwarded from info@ with the sender as Reply-To; the headers that would fail checks are gone; the body as it was');
}

{
  const out = rewrite(raw, { from: 'info@vuemesh.com', flag: '[Suspected spam]' });
  assert.ok(out.includes('\r\nSubject: [Suspected spam] Hello\r\n'));
  const own = rewrite('From: José <j@y.com>\nReply-To: r@y.com\nSubject: x\n\nbody', { from: 'info@vuemesh.com' });
  assert.ok(own.startsWith(`From: =?UTF-8?B?${Buffer.from('José via info').toString('base64')}?= <info@vuemesh.com>\n`));
  assert.ok(own.includes('Reply-To: r@y.com') && !own.includes('Reply-To: José'), 'their own Reply-To is kept');
  assert.equal(displayName('bob@y.com'), 'bob@y.com');
  assert.equal(displayName('<bob@y.com>'), 'bob@y.com');
  console.log('ok  suspected spam is marked in the subject; accented names are encoded; a sender\'s own Reply-To is kept');
}

console.log('\nAll mail forwarding tests passed.');
