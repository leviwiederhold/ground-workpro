import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const raw = process.env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("Missing PROVIDER_CREDENTIALS_ENCRYPTION_KEY");
  }

  const trimmed = raw.trim();
  const base64Buffer = Buffer.from(trimmed, "base64");
  if (base64Buffer.length === 32 && base64Buffer.toString("base64") === trimmed) {
    return base64Buffer;
  }

  const hexBuffer = Buffer.from(trimmed, "hex");
  if (hexBuffer.length === 32 && hexBuffer.toString("hex") === trimmed.toLowerCase()) {
    return hexBuffer;
  }

  const utf8Buffer = Buffer.from(trimmed, "utf8");
  if (utf8Buffer.length === 32) {
    return utf8Buffer;
  }

  throw new Error("PROVIDER_CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes");
}

export function encryptCredential(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${authTag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptCredential(ciphertext: string): string {
  const [ivPart, tagPart, payloadPart] = ciphertext.split(".");
  if (!ivPart || !tagPart || !payloadPart) {
    throw new Error("Invalid encrypted credential format");
  }

  const key = getKey();
  const iv = Buffer.from(ivPart, "base64");
  const authTag = Buffer.from(tagPart, "base64");
  const payload = Buffer.from(payloadPart, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
  return decrypted.toString("utf8");
}
