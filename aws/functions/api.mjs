// Lambda: HTTP API (payload v2) → core.api
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Route53Client, ChangeResourceRecordSetsCommand, ListResourceRecordSetsCommand } from '@aws-sdk/client-route-53';
import { api } from './lib/core.mjs';
import { dynamoStore } from './lib/store-dynamo.mjs';

const store = dynamoStore(process.env.TABLE);
const s3 = new S3Client({});
const Bucket = process.env.BUCKET;
const flags = { globe: process.env.GLOBE_ENABLED === 'true', publish: process.env.PUBLISH_ENABLED === 'true' };
const adminKeyHashes = (process.env.ADMIN_KEY_HASHES || '').split(',').map((h) => h.trim()).filter(Boolean);

async function listFilms(Prefix) {
  const out = [];
  let ContinuationToken;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }));
    for (const o of r.Contents || []) out.push({ key: o.Key, size: o.Size, lastModified: o.LastModified?.getTime?.() || null });
    ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return out;
}

async function deleteFilms(Prefix) {
  if (!Prefix.startsWith('films/')) throw new Error('Refusing to delete outside films/');
  const keys = (await listFilms(Prefix)).map((f) => ({ Key: f.key }));
  for (let i = 0; i < keys.length; i += 1000) {
    await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.slice(i, i + 1000), Quiet: true } }));
  }
  return keys.length;
}

// Local shows' certificate checks: one TXT record each, in the site's zone (only when it's set up)
const LAN_ZONE = process.env.LAN_ZONE_ID || '';
const r53 = LAN_ZONE ? new Route53Client({}) : null;
const txt = (Action, Name, values) => r53.send(new ChangeResourceRecordSetsCommand({ HostedZoneId: LAN_ZONE, ChangeBatch: { Changes: [{ Action, ResourceRecordSet: { Name, Type: 'TXT', TTL: 30, ResourceRecords: values } }] } }));
const lanDns = r53 && {
  setTxt: (name, value) => txt('UPSERT', name, [{ Value: `"${value}"` }]),
  async clearTxt(name) {
    const r = await r53.send(new ListResourceRecordSetsCommand({ HostedZoneId: LAN_ZONE, StartRecordName: name, StartRecordType: 'TXT', MaxItems: '1' }));
    const rs = r.ResourceRecordSets?.[0];
    if (rs && rs.Type === 'TXT' && rs.Name.replace(/\.$/, '') === name) await txt('DELETE', name, rs.ResourceRecords);
  },
};

const presign = (Key, ContentType) =>
  getSignedUrl(s3, new PutObjectCommand({ Bucket: process.env.BUCKET, Key, ContentType }), { expiresIn: 3600 });

// The API's catch-all route (ANY /{proxy+}) also catches the browser's CORS
// preflight (OPTIONS), so API Gateway forwards it here instead of answering it.
// Answer it directly, and put the same headers on every response.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,x-host-key,x-admin-key',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-max-age': '600',
};

export async function handler(event) {
  if (event.requestContext.http.method === 'OPTIONS') return { statusCode: 204, headers: CORS };
  let body = event.body;
  if (body && event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
  try { body = body ? JSON.parse(body) : undefined; } catch { body = undefined; }
  const res = await api(
    { method: event.requestContext.http.method, path: event.rawPath, query: event.queryStringParameters || {}, headers: event.headers || {}, body, ip: event.requestContext.http.sourceIp || '' },
    { store, presign, cdn: process.env.CDN, flags, adminKeyHashes, listFilms, deleteFilms, lanDns, lanDomain: process.env.LAN_DOMAIN },
  );
  return { statusCode: res.status, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(res.body) };
}
