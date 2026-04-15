// submit-suggestion/index.mjs
// Validates and stores a channel suggestion in DynamoDB.
// Checks an SSM parameter flag first; if set to "false" (budget exceeded),
// returns a quiet success so the user sees no error.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { randomUUID } from 'crypto';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ssmClient = new SSMClient({});

// In-memory cache for the SSM flag — avoids an SSM call on every request
let cachedEnabled = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60_000; // 60 seconds

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  // Check kill-switch (cached for 60s)
  const enabled = await isSubmissionsEnabled();
  if (!enabled) {
    // Quiet fail — user sees the same "thanks" message, nothing is written
    return ok({ success: false });
  }

  // Parse and validate body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return error(400, 'Invalid request body');
  }

  const channelName = (body.channelName ?? '').toString().trim().slice(0, 200);
  const channelUrl  = (body.channelUrl  ?? '').toString().trim().slice(0, 500);
  const platform    = (body.platform    ?? '').toString().trim();

  if (!channelName) {
    return error(400, 'channelName is required');
  }

  const VALID_PLATFORMS = new Set(['youtube', 'website', 'other']);
  const resolvedPlatform = VALID_PLATFORMS.has(platform) ? platform : 'other';

  await dynamo.send(new PutCommand({
    TableName: process.env.TABLE_NAME,
    Item: {
      submissionId: randomUUID(),
      channelName,
      channelUrl,
      platform: resolvedPlatform,
      submittedAt: new Date().toISOString(),
      status: 'pending',
    },
  }));

  return ok({ success: true });
};

async function isSubmissionsEnabled() {
  const now = Date.now();
  if (cachedEnabled !== null && now < cacheExpiry) {
    return cachedEnabled;
  }
  try {
    const result = await ssmClient.send(
      new GetParameterCommand({ Name: process.env.SSM_PARAM })
    );
    cachedEnabled = result.Parameter?.Value === 'true';
  } catch {
    // If SSM is unreachable, fail safe: disable submissions
    cachedEnabled = false;
  }
  cacheExpiry = now + CACHE_TTL_MS;
  return cachedEnabled;
}

function ok(data) {
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(data) };
}

function error(status, message) {
  return { statusCode: status, headers: CORS_HEADERS, body: JSON.stringify({ error: message }) };
}

// Resets the in-memory SSM cache. Only called by tests.
export function _resetCache() {
  cachedEnabled = null;
  cacheExpiry = 0;
}
