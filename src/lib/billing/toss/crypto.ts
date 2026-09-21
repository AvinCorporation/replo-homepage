import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
export type KeyRing = { active: string; keys: Record<string, string> };
function key(ring: KeyRing, version: string) {
  const value = Buffer.from(ring.keys[version] ?? "", "base64");
  if (value.length !== 32) throw new Error("INVALID_BILLING_ENCRYPTION_KEY");
  return value;
}
export function encryptCredential(
  plaintext: string,
  context: string,
  ring: KeyRing,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(ring, ring.active), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    encrypted_billing_key: [iv, cipher.getAuthTag(), ciphertext]
      .map((x) => x.toString("base64"))
      .join("."),
    encryption_key_version: ring.active,
  };
}
export function decryptCredential(
  encrypted: string,
  version: string,
  context: string,
  ring: KeyRing,
) {
  const parts = encrypted.split(".").map((x) => Buffer.from(x, "base64"));
  if (parts.length !== 3 || parts[0].length !== 12 || parts[1].length !== 16)
    throw new Error("INVALID_CREDENTIAL");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(ring, version),
    parts[0],
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(parts[1]);
  return Buffer.concat([decipher.update(parts[2]), decipher.final()]).toString(
    "utf8",
  );
}
export function stateDigest(state: string) {
  return createHash("sha256").update(state).digest("hex");
}
