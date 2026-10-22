// Cloudflare R2 storage for the encrypted clips. Settings live in private/.r2.json (never committed):
//   { "endpoint": "https://<account>.r2.cloudflarestorage.com", "bucket": "…",
//     "accessKeyId": "…", "secretAccessKey": "…", "publicUrl": "https://pub-….r2.dev" }
// Lines starting with // are allowed as comments. Errors never print the file's contents.
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const KEYS = ["endpoint", "bucket", "accessKeyId", "secretAccessKey", "publicUrl"];
// Only names the build creates (20 hex chars + .bin) are ever listed, replaced or removed.
const OURS = /^[0-9a-f]{20}\.bin$/;

export function loadR2(file) {
  if (!existsSync(file)) return null;
  let c;
  try {
    const raw = readFileSync(file, "utf8").replace(/^﻿/, "");
    c = JSON.parse(raw.split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join("\n"));
  } catch {
    throw new Error(`${file} isn't valid JSON (contents not shown).`);
  }
  const missing = KEYS.filter(k => !c[k]);
  if (missing.length) throw new Error(`${file} is missing: ${missing.join(", ")}`);
  if (/x{6,}/.test(c.publicUrl)) throw new Error(`${file}: publicUrl is still the placeholder. Copy the bucket's Public Development URL.`);
  return { ...c, publicUrl: c.publicUrl.replace(/\/+$/, "") };
}

export function r2Client(c) {
  const s3 = new S3Client({
    region: "auto", endpoint: c.endpoint,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
  });

  return {
    /** name → { size, etag } for the build's objects already in the bucket. */
    async list() {
      const out = new Map();
      let token;
      do {
        const r = await s3.send(new ListObjectsV2Command({ Bucket: c.bucket, ContinuationToken: token }));
        for (const o of r.Contents ?? []) if (OURS.test(o.Key)) out.set(o.Key, { size: o.Size, etag: (o.ETag ?? "").replace(/"/g, "") });
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
    /** Uploads unless an identical object (same MD5) is already there. Returns true if uploaded. */
    async put(name, buf, existing) {
      const md5 = createHash("md5").update(buf).digest("hex");
      const have = existing.get(name);
      if (have && have.size === buf.length && have.etag === md5) return false;
      await s3.send(new PutObjectCommand({
        Bucket: c.bucket, Key: name, Body: buf, ContentType: "application/octet-stream",
        // Names stay the same when a clip is re-cut, so browsers revalidate rather than cache forever.
        CacheControl: "no-cache",
      }));
      return true;
    },
    /** Removes the build's objects that are no longer published. */
    async prune(keep, existing) {
      const gone = [...existing.keys()].filter(k => !keep.has(k));
      for (let i = 0; i < gone.length; i += 1000) {
        await s3.send(new DeleteObjectsCommand({ Bucket: c.bucket, Delete: { Objects: gone.slice(i, i + 1000).map(Key => ({ Key })) } }));
      }
      return gone.length;
    },
    url: name => `${c.publicUrl}/${name}`,
  };
}

// The clips the manager plays (NOLA DFC Manager: supabase/functions/film-clip), as plain MP4s in a private
// bucket: private/.r2.json "clipsBucket". Nobody reads it directly; the manager hands out short-lived links.
export function loadClipsR2(file) {
  if (!existsSync(file)) return null;
  let c;
  try {
    const raw = readFileSync(file, "utf8").replace(/^﻿/, "");
    c = JSON.parse(raw.split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join("\n"));
  } catch {
    throw new Error(`${file} isn't valid JSON (contents not shown).`);
  }
  // The file may only hold the old encrypted bucket's settings so far.
  if (!c.clipsBucket) return null;
  const missing = ["endpoint", "accessKeyId", "secretAccessKey"].filter(k => !c[k]);
  if (missing.length) throw new Error(`${file} is missing: ${missing.join(", ")}`);
  return c;
}

export function clipsClient(c) {
  const s3 = new S3Client({
    region: "auto", endpoint: c.endpoint,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
  });
  const Bucket = c.clipsBucket;
  return {
    /** key → { size, etag } for every object under prefix. */
    async list(prefix) {
      const out = new Map();
      let token;
      do {
        const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
        for (const o of r.Contents ?? []) out.set(o.Key, { size: o.Size, etag: (o.ETag ?? "").replace(/"/g, "") });
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
    /** Uploads unless an identical object (same MD5) is already there. Returns true if uploaded. */
    async put(key, buf, existing) {
      const md5 = createHash("md5").update(buf).digest("hex");
      const have = existing.get(key);
      if (have && have.size === buf.length && have.etag === md5) return false;
      await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: buf, ContentType: "video/mp4", CacheControl: "private, no-cache" }));
      return true;
    },
    async remove(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.slice(i, i + 1000).map(Key => ({ Key })) } }));
      }
      return keys.length;
    },
  };
}
