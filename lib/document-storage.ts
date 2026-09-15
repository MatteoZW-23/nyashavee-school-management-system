import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const localRoot = path.join(process.cwd(), "data", "uploads");

function config() {
  const bucket = process.env.OBJECT_STORAGE_BUCKET?.trim();
  const endpoint = process.env.OBJECT_STORAGE_ENDPOINT?.trim();
  const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null;
  return { bucket, endpoint, accessKeyId, secretAccessKey, region: process.env.OBJECT_STORAGE_REGION?.trim() || "auto" };
}

function client(settings: NonNullable<ReturnType<typeof config>>) {
  return new S3Client({ endpoint: settings.endpoint, region: settings.region, forcePathStyle: true, credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey } });
}

export function objectStorageConfigured() {
  return Boolean(config());
}

export async function putStudentDocument(key: string, bytes: Uint8Array, contentType: string) {
  const settings = config();
  if (settings) {
    await client(settings).send(new PutObjectCommand({ Bucket: settings.bucket, Key: key, Body: bytes, ContentType: contentType, ServerSideEncryption: "AES256" }));
    return;
  }
  const filePath = path.join(localRoot, key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.from(bytes));
}

export async function getStudentDocument(key: string) {
  const settings = config();
  if (settings) {
    const response = await client(settings).send(new GetObjectCommand({ Bucket: settings.bucket, Key: key }));
    if (!response.Body) throw new Error("storage_object_missing");
    return new Uint8Array(await response.Body.transformToByteArray());
  }
  return new Uint8Array(await readFile(path.join(localRoot, key)));
}

export async function removeStudentDocument(key: string) {
  const settings = config();
  if (settings) {
    await client(settings).send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: key }));
    return;
  }
  await unlink(path.join(localRoot, key));
}
