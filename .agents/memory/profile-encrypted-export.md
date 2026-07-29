---
name: Encrypted profile exports
description: Passphrase-protected profile export/import — client-side AES-GCM envelope, server only rejects it
---

- Format "tachboard-profile-encrypted" v1 wraps the WHOLE plain profile JSON (including client theme bundle) — Web Crypto AES-256-GCM, PBKDF2-SHA-256 (310k iters), base64 salt/iv/ciphertext. All crypto lives client-side in `profileCrypto.ts`; the server never sees passphrases and just 400s the encrypted format with a "use Settings" message.
- **Why:** server export response is intentionally plain — encryption happens after fetch, before blob download. E2E test agents keep misreading the plain API response as "the bug"; only the downloaded file matters.
- Wrong passphrase and tampering are indistinguishable (GCM auth), one error message covers both. Iterations from a file are capped (≤5M) so hostile files can't hang the browser.
- **How to apply:** touching the envelope → bump ENCRYPTED_PROFILE_VERSION in profileCrypto.ts and keep the server-side format constant in routes/profile.ts in sync; e2e coverage in tests/e2e/profile-encrypted-export.spec.ts.
