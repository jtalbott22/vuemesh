// Lambda: WebSocket API ($connect / $disconnect / $default) → core.signal
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { signal } from './lib/core.mjs';
import { dynamoStore } from './lib/store-dynamo.mjs';

const store = dynamoStore(process.env.TABLE);
let mgmt;

export async function handler(event) {
  const { routeKey, connectionId, domainName, stage } = event.requestContext;
  mgmt ||= new ApiGatewayManagementApiClient({ endpoint: `https://${domainName}/${stage}` });
  const post = async (ConnectionId, data) => {
    try {
      await mgmt.send(new PostToConnectionCommand({ ConnectionId, Data: JSON.stringify(data) }));
      return true;
    } catch (e) {
      if (e.name === 'GoneException' || e.$metadata?.httpStatusCode === 410) return false;
      throw e;
    }
  };
  const res = await signal({ route: routeKey, connectionId, query: event.queryStringParameters || {}, body: event.body }, { store, post });
  return { statusCode: res.status };
}
