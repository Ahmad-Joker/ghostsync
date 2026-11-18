/**
 * Node unit-test environment setup (FAST FEEDBACK ONLY — NOT acceptance evidence).
 *
 * This file installs `fake-indexeddb` and a MINIMAL in-process Web Locks mock so
 * the Node/Vitest unit suite can exercise the codec, generation guard, and state
 * machine without a browser. Per REQ-BP-007 the ACCEPTANCE evidence is the
 * Playwright/Chromium run against REAL IndexedDB + real `crypto.subtle` SHA-256 +
 * the real `navigator.locks` API; everything wired here is explicitly a mock.
 */
import "fake-indexeddb/auto";

import { installWebLocksMock } from "./tests/support/web-locks-mock.js";

// Node 24 already exposes Web Crypto on `globalThis.crypto` (crypto.subtle), so
// SHA-256 digests in unit tests use the real implementation. Only the Web Locks
// API is absent in Node, so a labeled single-process mock stands in for it.
installWebLocksMock();
