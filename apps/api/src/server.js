// s3.js — Pre-signed URL generator for direct browser-to-S3 uploads.
//
// The browser requests an upload URL from the API, then PUTs the file
// straight to S3. The API never sees the file bytes — this keeps uploads
// fast and the server memory footprint small.
//
// Required env vars:
//   AWS_REGION              e.g. us-east-1
//   AWS_ACCESS_KEY_ID       from the IAM user's .csv
//   AWS_SECRET_ACCESS_KEY   from the same .csv
//   S3_BUCKET_NAME          the bucket to upload into
//
// If any is missing, isConfigured() returns false and the CMS falls back to
// a plain "paste an image URL" field.

import crypto from 'node:crypto';

const AWS_REGION            = process.env.AWS_REGION || '';
const AWS_ACCESS_KEY_ID     = process.env.AWS_ACCESS_KEY_ID || '';
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';
const S3_BUCKET_NAME        = process.env.S3_BUCKET_NAME || '';

const configured = !!(AWS_REGION && AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY && S3_BUCKET_NAME);

let s3Client = null;
let PutObjectCommand = null;
let getSignedUrl = null;

if (configured) {
  try {
    const clientMod  = await import('@aws-sdk/client-s3');
    const presignMod = await import('@aws-sdk/s3-request-presigner');
    PutObjectCommand = clientMod.PutObjectCommand;
    getSignedUrl     = presignMod.getSignedUrl;
    s3Client = new clientMod.S3Client({
      region: AWS_REGION,
      credentials: {
        accessKeyId:     AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
      },
    });
    console.log(`[s3] S3 uploads enabled → bucket ${S3_BUCKET_NAME} in ${AWS_REGION}`);
  } catch (err) {
    console.error('[s3] AWS SDK not installed — uploads disabled.');
    console.error('[s3] Run:  npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner');
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
 * Create a pre-signed PUT URL the browser can upload to directly.
 * Returns { uploadUrl, publicUrl, key }.
 */
export async function createUploadUrl({ fileType, folder = 'uploads' }) {
  if (!isConfigured()) throw new Error('S3 uploads are not configured');

  const ext = ALLOWED_IMAGE_TYPES.get(fileType);
  if (!ext) {
    throw new Error(`Unsupported file type: ${fileType}. Allowed: ${[...ALLOWED_IMAGE_TYPES.keys()].join(', ')}`);
  }

  const key = `${folder}/${crypto.randomUUID()}.${ext}`;

  const command = new PutObjectCommand({
    Bucket:      S3_BUCKET_NAME,
    Key:         key,
    ContentType: fileType,
  });

  // Upload URL expires in 5 minutes — plenty of time for a browser to PUT
  // an image, and short enough that a leaked URL is useless quickly.
  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

  // Public URL. This requires the bucket to allow public GET on `uploads/*`,
  // which you set up via the bucket policy step in the AWS walkthrough.
  const publicUrl = `https://${S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${key}`;

  return { uploadUrl, publicUrl, key };
}

export function s3Status() {
  return {
    configured: isConfigured(),
    bucket:     S3_BUCKET_NAME || null,
    region:     AWS_REGION || null,
    reason: !AWS_REGION            ? 'AWS_REGION not set'
          : !AWS_ACCESS_KEY_ID     ? 'AWS_ACCESS_KEY_ID not set'
          : !AWS_SECRET_ACCESS_KEY ? 'AWS_SECRET_ACCESS_KEY not set'
          : !S3_BUCKET_NAME        ? 'S3_BUCKET_NAME not set'
          : !s3Client              ? 'AWS SDK not installed'
          : null,
  };
}
