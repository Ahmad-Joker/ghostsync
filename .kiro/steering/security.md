---
inclusion: always
---

# Security

- Treat **every capsule as untrusted** input, regardless of source.
- **Bound size before decoding** — reject oversized payloads early, before parsing.
- **Validate before applying**: format, version, document identity, and checksum. Apply an update only after all checks pass.
- Document explicitly: a **checksum detects corruption; it does not authenticate the sender.** Capsules are integrity-checked, not authenticated.
- Keep **secrets and personal data out of public artifacts** — no keys, tokens, or PII in the repo, commits, or build output.
