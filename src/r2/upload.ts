// Cloudflare R2 upload — S3-compatible via AWS SDK
// Requires env vars:
//   CLOUDFLARE_R2_ENDPOINT       — https://<account-id>.r2.cloudflarestorage.com
//   CLOUDFLARE_R2_ACCESS_KEY_ID
//   CLOUDFLARE_R2_SECRET_ACCESS_KEY
//   CLOUDFLARE_R2_BUCKET
//   CLOUDFLARE_R2_PUBLIC_URL     — public base URL for the bucket (if enabled)

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import * as fs from "fs";
import "dotenv/config";

const r2 = new S3Client({
  region: "us-west-004",
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT!,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
});

export async function uploadToR2(
  filePath: string,
  key: string
): Promise<string> {
  const bucket = process.env.CLOUDFLARE_R2_BUCKET!;
  const publicBaseUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL!;

  if (!bucket || !publicBaseUrl) {
    throw new Error("CLOUDFLARE_R2_BUCKET and CLOUDFLARE_R2_PUBLIC_URL must be set");
  }

  console.log(`[R2] Uploading ${filePath} -> ${bucket}/${key}`);

  const body = fs.readFileSync(filePath);

  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "video/mp4",
    })
  );

  const url = `${publicBaseUrl.replace(/\/$/, "")}/${key}`;
  console.log(`[R2] Uploaded -> ${url}`);
  return url;
}