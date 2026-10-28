// s3.js — S3 access via the EC2 instance role.
//
// The browser never talks to S3 directly. Uploads go browser → API → S3,
// which avoids CORS entirely and works reliably on EC2.
//
// Required env vars:
//   AWS_REGION        e.g. ap-south-1
//   S3_BUCKET_NAME    e.g. kabonix-foundation-assets
//
// Optional (local dev only — do NOT set on EC2):
//   AWS_ACCESS_KEY_ID
//   AWS_SECRET_ACCESS_KEY

import crypto from 'node:crypto';

const AWS_REGION     = process.env.AWS_REGION || '';
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || '';

const hasStaticKeys = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
const credentialSource = hasStaticKeys ? 'static env vars' : 'EC2 instance role (IMDS)';

const configured = !!(AWS_REGION && S3_BUCKET_NAME);

let s3Client = null;
let PutObjectCommand = null;
let DeleteObjectCommand = null;

if (configured) {
  try {
    const clientMod = await import('@aws-sdk/client-s3');
    PutObjectCommand    = clientMod.PutObjectCommand;
    DeleteObjectCommand = clientMod.DeleteObjectCommand;

    s3Client = new clientMod.S3Client({ region: AWS_REGION });

    console.log(`[s3] S3 uploads enabled → bucket ${S3_BUCKET_NAME} in ${AWS_REGION}`);
    console.log(`[s3] Credential source: ${credentialSource}`);
    if (hasStaticKeys) {
      console.warn('[s3] ⚠️  Static AWS keys detected. Remove AWS_ACCESS_KEY_ID');
      console.warn('[s3]     and AWS_SECRET_ACCESS_KEY from .env — use the EC2 role.');
    }
  } catch (err) {
    console.error('[s3] AWS SDK not installed — uploads disabled.');
    console.error('[s3] Error:', err.message);
  }
} else {
  console.log('[s3] S3 uploads disabled (env vars not set). CMS will use URL-only mode.');
}

export function isConfigured() { return configured && !!s3Client; }

const ALLOWED_IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png',  'png'],
  ['image/webp', 'webp'],
  ['image/gif',  'gif'],
]);

/**
 * Upload raw bytes to S3 directly from the server. The browser never talks
 * to S3 directly, so no CORS is involved.
 */
export async function uploadBuffer({ buffer, contentType, folder = 'uploads' }) {
  if (!isConfigured()) throw new Error('S3 uploads are not configured');

  const ext = ALLOWED_IMAGE_TYPES.get(contentType);
  if (!ext) {
    throw new Error(`Unsupported file type: ${contentType}. Allowed: ${[...ALLOWED_IMAGE_TYPES.keys()].join(', ')}`);
  }

  const key = `${folder}/${crypto.randomUUID()}.${ext}`;

  const command = new PutObjectCommand({
    Bucket:      S3_BUCKET_NAME,
    Key:         key,
    ContentType: contentType,
    Body:        buffer,
  });

  await s3Client.send(command);

  const publicUrl = `https://${S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${key}`;
  return { publicUrl, key };
}

/**
 * Sanity check: can we actually reach S3 and write to the bucket?
 * Writes a small file, deletes it, returns ok/failure.
 */
export async function verifyConnection() {
  if (!isConfigured()) return { ok: false, reason: 'not configured' };
  try {
    const testKey = `uploads/_healthcheck-${Date.now()}.txt`;
    await s3Client.send(new PutObjectCommand({
      Bucket:      S3_BUCKET_NAME,
      Key:         testKey,
      ContentType: 'text/plain',
      Body:        Buffer.from('ok'),
    }));
    await s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET_NAME, Key: testKey }));
    return { ok: true, credentialSource };
  } catch (err) {
    return { ok: false, reason: err.message, name: err.name };
  }
}

export function s3Status() {
  return {
    configured: isConfigured(),
    bucket:     S3_BUCKET_NAME || null,
    region:     AWS_REGION || null,
    credentialSource,
    reason: !AWS_REGION     ? 'AWS_REGION not set'
          : !S3_BUCKET_NAME ? 'S3_BUCKET_NAME not set'
          : !s3Client       ? 'AWS SDK not installed'
          : null,
  };
}
