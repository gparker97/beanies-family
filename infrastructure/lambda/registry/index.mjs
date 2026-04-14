/* global process */
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const client = new DynamoDBClient({});
const PROD_TABLE = process.env.TABLE_NAME;
const DEV_TABLE = process.env.DEV_TABLE_NAME || PROD_TABLE; // safe fallback
const API_KEY = process.env.REGISTRY_API_KEY;
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || 'https://beanies.family')
  .split(',')
  .map((o) => o.trim());
const DEV_ORIGINS = new Set(
  (process.env.DEV_ORIGINS || 'http://localhost:5173,http://localhost:4173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
);

/**
 * Pick the DynamoDB table based on the request Origin. Localhost origins
 * write to the dev table; everything else writes to prod. Unknown origins
 * default to prod for safety — but they would also fail CORS upstream so
 * in practice only allowlisted origins ever reach the Lambda body.
 */
function tableForOrigin(origin) {
  return origin && DEV_ORIGINS.has(origin) ? DEV_TABLE : PROD_TABLE;
}

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
  const tableName = tableForOrigin(event.headers?.origin);

  try {
    if (method === 'GET') {
      const { Item } = await client.send(
        new GetItemCommand({
          TableName: tableName,
          Key: marshall({ familyId }),
        })
      );
      if (!Item) return response(404, { error: 'Family not found' }, event);
      return response(200, unmarshall(Item), event);
    }

    if (method === 'PUT') {
      const body = JSON.parse(event.body || '{}');
      const now = new Date().toISOString();

      // Read existing row to preserve write-once fields (createdAt, ownerEmail,
      // subscribeNewsletter). registerFamily() fires on every sync-config change,
      // so only the first write should stamp these.
      const { Item: existingRaw } = await client.send(
        new GetItemCommand({
          TableName: tableName,
          Key: marshall({ familyId }),
        })
      );
      const existing = existingRaw ? unmarshall(existingRaw) : {};

      const item = {
        familyId,
        provider: body.provider || 'local',
        fileId: body.fileId || null,
        displayPath: body.displayPath || null,
        familyName: body.familyName || null,
        createdAt: existing.createdAt || now,
        ownerEmail: body.ownerEmail ?? existing.ownerEmail ?? null,
        subscribeNewsletter:
          typeof body.subscribeNewsletter === 'boolean'
            ? body.subscribeNewsletter
            : (existing.subscribeNewsletter ?? null),
        updatedAt: now,
      };
      await client.send(
        new PutItemCommand({
          TableName: tableName,
          Item: marshall(item, { removeUndefinedValues: true }),
        })
      );
      return response(200, { success: true }, event);
    }

    if (method === 'DELETE') {
      await client.send(
        new DeleteItemCommand({
          TableName: tableName,
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
