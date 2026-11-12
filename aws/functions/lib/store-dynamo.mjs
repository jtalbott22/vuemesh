// DynamoDB single-table store. Layout:
//   pk EVT#<id>     sk META          the event (gh set only when public → sparse "geo" index)
//   pk EVT#<id>     sk CONN#<conn>   a live WebSocket connection in that event
//   pk CONN#<conn>  sk C             reverse lookup for $disconnect
//   pk STATS        sk DAY#<date>    one day's anonymous counts (kept: no ttl)
//   pk STATS        sk SNAP#<iso>    a growth snapshot saved from Admin (kept)
// Every item carries a ttl so nothing needs cleaning up by hand.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand, ScanCommand,
} from '@aws-sdk/lib-dynamodb';

export function dynamoStore(TableName) {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

  const update = async (Key, fields) => {
    const set = [], remove = [], names = {}, values = {};
    Object.entries(fields).forEach(([k, v], i) => {
      names['#k' + i] = k;
      if (v === null || v === undefined) remove.push('#k' + i);
      else { set.push(`#k${i} = :v${i}`); values[':v' + i] = v; }
    });
    if (!set.length && !remove.length) return (await db.send(new GetCommand({ TableName, Key }))).Item;
    const expr = [set.length ? 'SET ' + set.join(', ') : '', remove.length ? 'REMOVE ' + remove.join(', ') : ''].join(' ').trim();
    const r = await db.send(new UpdateCommand({
      TableName, Key,
      UpdateExpression: expr,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: Object.keys(values).length ? values : undefined,
      ConditionExpression: 'attribute_exists(pk)',
      ReturnValues: 'ALL_NEW',
    }));
    return r.Attributes;
  };

  return {
    async getEvent(id) {
      const r = await db.send(new GetCommand({ TableName, Key: { pk: `EVT#${id}`, sk: 'META' } }));
      return r.Item || null;
    },
    async putEventIfAbsent(meta) {
      try {
        await db.send(new PutCommand({ TableName, Item: { pk: `EVT#${meta.id}`, sk: 'META', ...meta }, ConditionExpression: 'attribute_not_exists(pk)' }));
        return true;
      } catch (e) {
        if (e.name === 'ConditionalCheckFailedException') return false;
        throw e;
      }
    },
    updateEvent: (id, fields) => update({ pk: `EVT#${id}`, sk: 'META' }, fields),
    // only if `field` is still `value` (or missing, for false): the first phone to name a kiosk show wins
    async updateEventIf(id, fields, field, value) {
      const names = { '#c': field }, values = { ':c': value }, set = [];
      Object.entries(fields).forEach(([k, v], i) => {
        names['#k' + i] = k;
        values[':v' + i] = v;
        set.push(`#k${i} = :v${i}`);
      });
      try {
        const r = await db.send(new UpdateCommand({
          TableName, Key: { pk: `EVT#${id}`, sk: 'META' }, UpdateExpression: 'SET ' + set.join(', '),
          ExpressionAttributeNames: names, ExpressionAttributeValues: values,
          ConditionExpression: value === false ? 'attribute_exists(pk) AND (attribute_not_exists(#c) OR #c = :c)' : 'attribute_exists(pk) AND #c = :c',
          ReturnValues: 'ALL_NEW',
        }));
        return r.Attributes;
      } catch (e) {
        if (e.name === 'ConditionalCheckFailedException') return null;
        throw e;
      }
    },
    async listByCells(cells) {
      const out = await Promise.all(cells.map((gh) => db.send(new QueryCommand({
        TableName, IndexName: 'geo', KeyConditionExpression: 'gh = :g', ExpressionAttributeValues: { ':g': gh }, Limit: 50, ScanIndexForward: false,
      }))));
      return out.flatMap((r) => r.Items || []);
    },
    async listPublic(limit) {
      const r = await db.send(new QueryCommand({
        TableName, IndexName: 'pub', KeyConditionExpression: 'pub = :p', ExpressionAttributeValues: { ':p': 'P' }, Limit: limit, ScanIndexForward: false,
      }));
      return r.Items || [];
    },
    async scanEvents(cursor, limit) {
      // Scan pages are counted before filtering, so keep reading until we have some events or run out.
      let ExclusiveStartKey = cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString()) : undefined;
      const items = [];
      do {
        const r = await db.send(new ScanCommand({
          TableName, Limit: limit * 4, ExclusiveStartKey,
          FilterExpression: 'sk = :m', ExpressionAttributeValues: { ':m': 'META' },
        }));
        items.push(...(r.Items || []));
        ExclusiveStartKey = r.LastEvaluatedKey;
      } while (ExclusiveStartKey && items.length < limit);
      return { items, next: ExclusiveStartKey ? Buffer.from(JSON.stringify(ExclusiveStartKey)).toString('base64url') : null };
    },
    async deleteEvent(id) {
      const conns = await db.send(new QueryCommand({
        TableName, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': `EVT#${id}` },
      }));
      await Promise.all((conns.Items || []).map((it) => db.send(new DeleteCommand({ TableName, Key: { pk: it.pk, sk: it.sk } }))));
    },
    async addConn(eventId, connId, info) {
      await Promise.all([
        db.send(new PutCommand({ TableName, Item: { pk: `EVT#${eventId}`, sk: `CONN#${connId}`, connId, ...info } })),
        db.send(new PutCommand({ TableName, Item: { pk: `CONN#${connId}`, sk: 'C', eventId, ttl: info.ttl } })),
      ]);
    },
    async getConnEvent(connId) {
      const r = await db.send(new GetCommand({ TableName, Key: { pk: `CONN#${connId}`, sk: 'C' } }));
      return r.Item?.eventId || null;
    },
    async removeConn(eventId, connId) {
      await Promise.all([
        db.send(new DeleteCommand({ TableName, Key: { pk: `EVT#${eventId}`, sk: `CONN#${connId}` } })),
        db.send(new DeleteCommand({ TableName, Key: { pk: `CONN#${connId}`, sk: 'C' } })),
      ]);
    },
    async listConns(eventId) {
      const r = await db.send(new QueryCommand({
        TableName, KeyConditionExpression: 'pk = :p AND begins_with(sk, :c)', ExpressionAttributeValues: { ':p': `EVT#${eventId}`, ':c': 'CONN#' },
      }));
      return r.Items || [];
    },
    updateConn: (eventId, connId, fields) => update({ pk: `EVT#${eventId}`, sk: `CONN#${connId}` }, fields).catch(() => null),
    // ---- growth: anonymous day counts (never expire) ----
    async bumpStats(day, counts) {
      const keys = Object.keys(counts);
      if (!keys.length) return;
      const names = { '#day': 'day' }, values = { ':day': day };
      keys.forEach((k, n) => {
        names[`#c${n}`] = k;
        values[`:c${n}`] = counts[k];
      });
      await db.send(new UpdateCommand({
        TableName, Key: { pk: 'STATS', sk: `DAY#${day}` },
        UpdateExpression: `SET #day = :day ADD ${keys.map((_, n) => `#c${n} :c${n}`).join(', ')}`,
        ExpressionAttributeNames: names, ExpressionAttributeValues: values,
      }));
    },
    async putStatsIfAbsent(day, counts) {
      try {
        await db.send(new PutCommand({ TableName, Item: { pk: 'STATS', sk: `DAY#${day}`, day, ...counts }, ConditionExpression: 'attribute_not_exists(pk)' }));
        return true;
      } catch (e) {
        if (e.name === 'ConditionalCheckFailedException') return false;
        throw e;
      }
    },
    async listStats(from, to) {
      const out = [];
      let ExclusiveStartKey;
      do {
        const r = await db.send(new QueryCommand({
          TableName, KeyConditionExpression: 'pk = :p AND sk BETWEEN :a AND :b',
          ExpressionAttributeValues: { ':p': 'STATS', ':a': `DAY#${from}`, ':b': `DAY#${to}` }, ExclusiveStartKey,
        }));
        out.push(...(r.Items || []).map(({ pk, sk, ...rest }) => rest));
        ExclusiveStartKey = r.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return out;
    },
    async setStat(day, key, value) {
      const r = await db.send(new UpdateCommand({
        TableName, Key: { pk: 'STATS', sk: `DAY#${day}` }, UpdateExpression: 'SET #day = :day, #k = :v',
        ExpressionAttributeNames: { '#day': 'day', '#k': key }, ExpressionAttributeValues: { ':day': day, ':v': value }, ReturnValues: 'ALL_NEW',
      }));
      const { pk, sk, ...rest } = r.Attributes || {};
      return rest;
    },
    // ---- web traffic: anonymous counts by day (its own partition; never expire) ----
    async bumpTraffic(day, counts) {
      const keys = Object.keys(counts);
      if (!keys.length) return;
      const names = { '#day': 'day' }, values = { ':day': day };
      keys.forEach((k, n) => {
        names[`#c${n}`] = k;
        values[`:c${n}`] = counts[k];
      });
      await db.send(new UpdateCommand({
        TableName, Key: { pk: 'TRAFFIC', sk: `DAY#${day}` },
        UpdateExpression: `SET #day = :day ADD ${keys.map((_, n) => `#c${n} :c${n}`).join(', ')}`,
        ExpressionAttributeNames: names, ExpressionAttributeValues: values,
      }));
    },
    async listTraffic(from, to) {
      const out = [];
      let ExclusiveStartKey;
      do {
        const r = await db.send(new QueryCommand({
          TableName, KeyConditionExpression: 'pk = :p AND sk BETWEEN :a AND :b',
          ExpressionAttributeValues: { ':p': 'TRAFFIC', ':a': `DAY#${from}`, ':b': `DAY#${to}` }, ExclusiveStartKey,
        }));
        out.push(...(r.Items || []).map(({ pk, sk, ...rest }) => rest));
        ExclusiveStartKey = r.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return out;
    },
    /** True the first time a key is seen (it's forgotten after two days: the table's TTL). */
    // a local show's address (vuemesh-local.mjs): who may put its certificate check in the DNS
    async getLan(slug) {
      return (await db.send(new GetCommand({ TableName, Key: { pk: `LAN#${slug}`, sk: 'L' } }))).Item || null;
    },
    async putLanIfAbsent(rec) {
      try {
        await db.send(new PutCommand({ TableName, Item: { pk: `LAN#${rec.slug}`, sk: 'L', ...rec }, ConditionExpression: 'attribute_not_exists(pk)' }));
        return true;
      } catch (e) {
        if (e.name === 'ConditionalCheckFailedException') return false;
        throw e;
      }
    },
    async daySalt(day, fresh) {
      try {
        await db.send(new PutCommand({ TableName, Item: { pk: 'SALT', sk: day, salt: fresh, ttl: Math.floor(Date.now() / 1000) + 2 * 86400 }, ConditionExpression: 'attribute_not_exists(pk)' }));
        return fresh;
      } catch (e) {
        if (e.name !== 'ConditionalCheckFailedException') throw e;
        return (await db.send(new GetCommand({ TableName, Key: { pk: 'SALT', sk: day }, ConsistentRead: true }))).Item.salt;
      }
    },
    async markOnce(key) {
      try {
        await db.send(new PutCommand({ TableName, Item: { pk: 'SEEN', sk: key, ttl: Math.floor(Date.now() / 1000) + 2 * 86400 }, ConditionExpression: 'attribute_not_exists(pk)' }));
        return true;
      } catch (e) {
        if (e.name === 'ConditionalCheckFailedException') return false;
        throw e;
      }
    },
    async putSnapshot(snap) {
      await db.send(new PutCommand({ TableName, Item: { pk: 'STATS', sk: `SNAP#${snap.at}`, ...snap } }));
    },
    async listSnapshots() {
      const r = await db.send(new QueryCommand({ TableName, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'STATS', ':s': 'SNAP#' }, ScanIndexForward: false, Limit: 100 }));
      return (r.Items || []).map(({ pk, sk, ...rest }) => rest);
    },
  };
}
