// How a message is rewritten to be forwarded (no AWS here, so it can be tested on its own).
// It's sent *from* info@ (a mailbox can't send as someone else's address, and Gmail rejects mail
// that claims to be from a domain it can't verify), with the original sender in Reply-To, so
// pressing Reply answers them.

// Headers that would make the forwarded copy fail checks or be refused by SES.
const DROP = /^(return-path|sender|message-id|dkim-signature|domainkey-signature|arc-[a-z-]+|authentication-results|received-spf|x-ses-[a-z-]+|x-original-to|delivered-to)$/i;

/** Splits a raw message into its header lines (folded continuations kept with their header) and body. */
export function splitMessage(raw) {
  const m = raw.match(/\r?\n\r?\n/);
  const cut = m ? m.index : raw.length;
  const head = raw.slice(0, cut), body = m ? raw.slice(cut + m[0].length) : '';
  const nl = /\r\n/.test(head) ? '\r\n' : '\n';
  const headers = [];
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && headers.length) headers[headers.length - 1] += nl + line;
    else if (line) headers.push(line);
  }
  return { headers, body, nl };
}

const nameOf = (h) => h.slice(0, h.indexOf(':')).trim();
const valueOf = (h) => h.slice(h.indexOf(':') + 1).replace(/\r?\n[ \t]+/g, ' ').trim();

/** "Ana Ruiz" <ana@x.com> → Ana Ruiz; ana@x.com → ana@x.com (encoded words are left as they are). */
export function displayName(from) {
  const q = from.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>/);
  const name = q?.[1]?.trim();
  if (name) return name;
  return (from.match(/<([^>]+)>/)?.[1] || from).trim();
}

/** The message as it's forwarded: from info@, Reply-To the sender, the checks' failing headers taken out. */
export function rewrite(raw, { from, flag = '' }) {
  const { headers, body, nl } = splitMessage(raw);
  let original = '', hasReplyTo = false;
  const kept = [];
  for (const h of headers) {
    const n = nameOf(h);
    if (/^from$/i.test(n)) { original = valueOf(h); continue; }
    if (/^reply-to$/i.test(n)) hasReplyTo = true;
    if (/^subject$/i.test(n) && flag) { kept.push(`Subject: ${flag} ${valueOf(h)}`); continue; }
    if (DROP.test(n)) continue;
    kept.push(h);
  }
  const name = displayName(original).replace(/["\\\r\n]/g, '');
  const enc = /[^\x20-\x7e]/.test(name) ? `=?UTF-8?B?${Buffer.from(`${name} via info`).toString('base64')}?=` : `"${name} via info"`;
  kept.unshift(`From: ${enc} <${from}>`);
  if (!hasReplyTo && original) kept.push(`Reply-To: ${original}`);
  if (flag && !kept.some((h) => /^subject:/i.test(h))) kept.push(`Subject: ${flag}`);
  return kept.join(nl) + nl + nl + body;
}
