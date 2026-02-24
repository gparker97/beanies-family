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
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || 'https://beanies.family')
  .split(',')
  .map((o) => o.trim());

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getHeaders(event) {
  const origin = event?.headers?.origin || ALLOWED_ORIGINS[0];
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  };
}

function response(statusCode, body, event) {
  return { statusCode, headers: getHeaders(event), body: JSON.stringify(body) };
}

export async function handler(event) {
  // API key check
  const key = event.headers?.['x-api-key'];
  if (key !== API_KEY) {
    return response(401, { error: 'Unauthorized' }, event);
  }

  const familyId = event.pathParameters?.familyId;
  if (!familyId || !UUID_RE.test(familyId)) {
    return response(400, { error: 'Invalid familyId — must be a UUID' }, event);
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
      if (!Item) return response(404, { error: 'Family not found' }, event);
      return response(200, unmarshall(Item), event);
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
      return response(200, { success: true }, event);
    }

    if (method === 'DELETE') {
      await client.send(
        new DeleteItemCommand({
          TableName: TABLE_NAME,
          Key: marshall({ familyId }),
        })
      );
      return response(200, { success: true }, event);
    }

    return response(405, { error: 'Method not allowed' }, event);
  } catch (err) {
    console.error('Registry error:', err);
    return response(500, { error: 'Internal server error' }, event);
  }
}
