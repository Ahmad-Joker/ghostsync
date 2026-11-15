# @ghostsync/qr-transfer

Static QR transfer for `.gscap` capsule bytes. The package treats bytes as opaque: it never parses a capsule, merges, stores, or uses the network.

**A checksum detects corruption; it does not authenticate the sender.** Anyone who can show a code can show a valid capsule. QR codes are integrity-checked, not authenticated.

## Frame

`GSQ1:` + Base45(bytes) (RFC 9285), carried as one QR alphanumeric segment at level L, versions 1 to 25.
Limit: 1232 bytes = 1853 characters (5 prefix + 1848 Base45). 1233 bytes is `TooLarge`.
`decodeFrame` checks the text length first, then the prefix, length, alphabet and group ranges, and allocates the output once, with the exact length, only after every check passes. It never trims or repairs text.

## Entries

- `@ghostsync/qr-transfer` (pure, Node-testable): `encodeFrame`, `decodeFrame`, `buildQrSymbol`, `QrTransferError`, limits.
- `@ghostsync/qr-transfer/browser`: `paintQr`, `chooseScale`, `createScanSession` (camera, bundled `jsqr` decoder loaded lazily on `start()`).

The scan session asks for the camera only when `start()` runs, closes it on stop, accept, `pagehide`, a hidden page, a track ending and after 120 s, and delivers at most one accepted result. Each start owns its own stream, so a late `getUserMedia` of an earlier start cannot close or replace a newer stream.

See `THIRD_PARTY_NOTICES.md` for `jsqr` (Apache-2.0) and `uqr` (MIT).
