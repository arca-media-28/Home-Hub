import { describe, it, expect } from "vitest";
import {
  encryptProfileFile,
  decryptProfileFile,
  isEncryptedProfileFile,
  ProfileDecryptError,
  ENCRYPTED_PROFILE_FORMAT,
} from "./profileCrypto";

const SAMPLE = JSON.stringify({
  format: "tachboard-profile",
  version: 1,
  pages: [],
  deviceModes: [],
  connections: [{ service: "sonarr", apiKey: "secret-key" }],
});

describe("profile file encryption", () => {
  it("round-trips a profile with the right passphrase", async () => {
    const encrypted = await encryptProfileFile(SAMPLE, "hunter2");
    expect(encrypted.format).toBe(ENCRYPTED_PROFILE_FORMAT);
    expect(isEncryptedProfileFile(encrypted)).toBe(true);
    // Credentials must not be readable in the encrypted envelope.
    expect(JSON.stringify(encrypted)).not.toContain("secret-key");
    const plain = await decryptProfileFile(encrypted, "hunter2");
    expect(plain).toBe(SAMPLE);
  });

  it("rejects a wrong passphrase with a clear error", async () => {
    const encrypted = await encryptProfileFile(SAMPLE, "hunter2");
    await expect(decryptProfileFile(encrypted, "wrong")).rejects.toThrowError(
      ProfileDecryptError,
    );
    await expect(decryptProfileFile(encrypted, "wrong")).rejects.toThrow(
      /wrong passphrase/i,
    );
  });

  it("rejects tampered ciphertext", async () => {
    const encrypted = await encryptProfileFile(SAMPLE, "hunter2");
    const bytes = Uint8Array.from(atob(encrypted.ciphertext), (c) => c.charCodeAt(0));
    bytes[0] = bytes[0]! ^ 0xff;
    encrypted.ciphertext = btoa(String.fromCharCode(...bytes));
    await expect(decryptProfileFile(encrypted, "hunter2")).rejects.toThrowError(
      ProfileDecryptError,
    );
  });

  it("rejects unsupported versions and malformed envelopes", async () => {
    const encrypted = await encryptProfileFile(SAMPLE, "hunter2");
    await expect(
      decryptProfileFile({ ...encrypted, version: 99 }, "hunter2"),
    ).rejects.toThrow(/version/i);
    await expect(
      decryptProfileFile(
        { ...encrypted, kdf: { ...encrypted.kdf, iterations: 10_000_000 } },
        "hunter2",
      ),
    ).rejects.toThrow(/malformed/i);
    await expect(
      decryptProfileFile({ ...encrypted, ciphertext: "%%%not-base64%%%" }, "hunter2"),
    ).rejects.toThrow(/malformed/i);
  });

  it("does not recognize plain profile files as encrypted", () => {
    expect(isEncryptedProfileFile(JSON.parse(SAMPLE))).toBe(false);
    expect(isEncryptedProfileFile(null)).toBe(false);
  });
});
