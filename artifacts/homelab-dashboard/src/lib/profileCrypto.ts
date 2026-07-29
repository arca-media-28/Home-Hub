// Passphrase-based encryption for exported profile files.
//
// When a profile export includes service connections, the user can protect it
// with a passphrase. The whole plain-JSON export (including the browser theme
// bundle) is encrypted client-side with AES-256-GCM using a key derived from
// the passphrase via PBKDF2-SHA-256, then wrapped in a small versioned
// envelope. The server never sees the passphrase or the encrypted file — the
// import flow decrypts in the browser before posting the plain envelope.

export const ENCRYPTED_PROFILE_FORMAT = "tachboard-profile-encrypted";
export const ENCRYPTED_PROFILE_VERSION = 1;

const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedProfileFile {
  format: typeof ENCRYPTED_PROFILE_FORMAT;
  version: number;
  exportedAt?: string;
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    salt: string; // base64
  };
  cipher: {
    name: "AES-GCM";
    iv: string; // base64
  };
  ciphertext: string; // base64
}

export function isEncryptedProfileFile(value: unknown): value is EncryptedProfileFile {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { format?: unknown }).format === ENCRYPTED_PROFILE_FORMAT
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// Encrypt an already-serialized plain profile file into an encrypted envelope.
export async function encryptProfileFile(
  plainJson: string,
  passphrase: string,
): Promise<EncryptedProfileFile> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plainJson),
  );
  return {
    format: ENCRYPTED_PROFILE_FORMAT,
    version: ENCRYPTED_PROFILE_VERSION,
    exportedAt: new Date().toISOString(),
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: PBKDF2_ITERATIONS,
      salt: toBase64(salt),
    },
    cipher: { name: "AES-GCM", iv: toBase64(iv) },
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

export class ProfileDecryptError extends Error {}

// Decrypt an encrypted envelope back into the plain profile JSON string.
// A wrong passphrase (or tampered file) throws ProfileDecryptError — AES-GCM
// authenticates the ciphertext, so the two cases are indistinguishable.
export async function decryptProfileFile(
  file: EncryptedProfileFile,
  passphrase: string,
): Promise<string> {
  if (file.version !== ENCRYPTED_PROFILE_VERSION) {
    throw new ProfileDecryptError(
      `Unsupported encrypted profile version: ${file.version}. This file was created by a different version.`,
    );
  }
  if (
    file.kdf?.name !== "PBKDF2" ||
    file.kdf?.hash !== "SHA-256" ||
    file.cipher?.name !== "AES-GCM" ||
    typeof file.kdf.salt !== "string" ||
    typeof file.cipher.iv !== "string" ||
    typeof file.ciphertext !== "string"
  ) {
    throw new ProfileDecryptError("This encrypted profile file is malformed.");
  }
  const iterations = Number(file.kdf.iterations);
  // Cap iterations so a hostile file can't lock up the browser.
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 5_000_000) {
    throw new ProfileDecryptError("This encrypted profile file is malformed.");
  }
  let salt: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array;
  try {
    salt = fromBase64(file.kdf.salt);
    iv = fromBase64(file.cipher.iv);
    ciphertext = fromBase64(file.ciphertext);
  } catch {
    throw new ProfileDecryptError("This encrypted profile file is malformed.");
  }
  const key = await deriveKey(passphrase, salt, iterations);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new ProfileDecryptError(
      "Wrong passphrase, or the file has been modified.",
    );
  }
}
