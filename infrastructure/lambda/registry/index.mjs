/* global process */
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const client = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME;
const API_KEY = process.env.REGISTRY_API_KEY;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://beanies.family';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': CORS_ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
};

function response(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

export async function handler(event) {
  // API key check
  const key = event.headers?.['x-api-key'];
  if (key !== API_KEY) {
    return response(401, { error: 'Unauthorized' });
  }

  const familyId = event.pathParameters?.familyId;
  if (!familyId || !UUID_RE.test(familyId)) {
    return response(400, { error: 'Invalid familyId — must be a UUID' });
  }

  const method = event.requestContext?.http?.method;

  try {
    if (method === 'GET') {
      const { Item } = await client.send(
        new GetItemCommand({
          TableName: TABLE_NAME,
          Key: marshall({ familyId }),
        })
      );
      if (!Item) return response(404, { error: 'Family not found' });
      return response(200, unmarshall(Item));
    }

    if (method === 'PUT') {
      const body = JSON.parse(event.body || '{}');
      const item = {
        familyId,
        provider: body.provider || 'local',
        fileId: body.fileId || null,
        displayPath: body.displayPath || null,
        familyName: body.familyName || null,
        updatedAt: new Date().toISOString(),
      };
      await client.send(
        new PutItemCommand({
          TableName: TABLE_NAME,
          Item: marshall(item, { removeUndefinedValues: true }),
        })
      );
      return response(200, { success: true });
    }

    if (method === 'DELETE') {
      await client.send(
        new DeleteItemCommand({
          TableName: TABLE_NAME,
          Key: marshall({ familyId }),
        })
      );
      return response(200, { success: true });
    }

    return response(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('Registry error:', err);
    return response(500, { error: 'Internal server error' });
  }
}
