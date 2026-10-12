// Team-password encryption shared by the build and its tests. Matches app/src/lib/crypto.ts.
import { createCipheriv, createHmac, pbkdf2Sync } from "node:crypto";

export function keysFrom(password, kdf) {
  const key = pbkdf2Sync(password, Buffer.from(kdf.salt, "base64"), kdf.iterations, 32, "sha256");
  return {
    key,
    ivKey: createHmac("sha256", key).update("dfc-film iv derivation").digest(),
    nameKey: createHmac("sha256", key).update("dfc-film name derivation").digest(),
  };
}

// Published name of a source path: HMAC → 20 hex chars + ".bin". Nothing about the game shows.
export const opaque = (nameKey, path) => createHmac("sha256", nameKey).update(path).digest("hex").slice(0, 20) + ".bin";

// iv (12 bytes) || ciphertext || GCM tag (16 bytes), the layout WebCrypto's AES-GCM decrypt expects after the iv.
// The IV is an HMAC of path and content, so unchanged files encrypt to identical bytes (git sees no change),
// and different content never reuses an IV.
export function seal({ key, ivKey }, path, buf) {
  const iv = createHmac("sha256", ivKey).update(path).update("\0").update(buf).digest().subarray(0, 12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([iv, c.update(buf), c.final(), c.getAuthTag()]);
}
