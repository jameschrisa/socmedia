#!/usr/bin/env node
/**
 * Downloads the newest suprstar backup archive from S3-compatible offsite storage (for when the
 * disk itself is gone). Uses the same env vars as server/src/services/backup.ts:
 *   BACKUP_S3_BUCKET (required), BACKUP_S3_REGION (default "auto"), BACKUP_S3_ENDPOINT (optional,
 *   for Cloudflare R2 / Backblaze B2), BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY,
 *   BACKUP_S3_PREFIX (default "suprstar").
 *
 * Usage: node scripts/fetch-backup.mjs [outputDir]   (default outputDir: cwd)
 * Then restore it with scripts/restore-backup.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const bucket = process.env.BACKUP_S3_BUCKET || "";
const region = process.env.BACKUP_S3_REGION || "auto";
const endpoint = process.env.BACKUP_S3_ENDPOINT || "";
const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY_ID || "";
const secretAccessKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY || "";
const prefix = (process.env.BACKUP_S3_PREFIX || "suprstar").replace(/^\/+|\/+$/g, "");

async function main() {
  if (!bucket) {
    console.error("Error: BACKUP_S3_BUCKET is not set.");
    return 1;
  }
  const outputDir = path.resolve(process.argv[2] || process.cwd());
  fs.mkdirSync(outputDir, { recursive: true });

  const client = new S3Client({
    region,
    endpoint: endpoint || undefined,
    forcePathStyle: !!endpoint,
    credentials: accessKeyId ? { accessKeyId, secretAccessKey } : undefined,
  });

  console.log(`Listing s3://${bucket}/${prefix}/ ...`);
  let newest;
  let continuationToken;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: `${prefix}/`, ContinuationToken: continuationToken })
    );
    for (const obj of page.Contents || []) {
      if (!obj.Key || !/\.tar\.gz$/.test(obj.Key)) continue;
      if (!newest || (obj.LastModified?.getTime() ?? 0) > (newest.LastModified?.getTime() ?? 0)) newest = obj;
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  if (!newest || !newest.Key) {
    console.error(`No backup archives found under s3://${bucket}/${prefix}/`);
    return 1;
  }

  const name = path.basename(newest.Key);
  const outPath = path.join(outputDir, name);
  console.log(`Downloading s3://${bucket}/${newest.Key} (${newest.Size ?? "?"} bytes) -> ${outPath}`);

  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: newest.Key }));
  await pipeline(result.Body, fs.createWriteStream(outPath));

  console.log(`Done. Fetched -> ${outPath}`);
  console.log(`Restore it with: node scripts/restore-backup.mjs ${outPath} <dataDir> --force`);
  return 0;
}

const code = await main();
process.exit(code);
