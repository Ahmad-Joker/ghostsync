/** Byte-input guards and owned snapshots (NFR-CAP-003). */

/** TypeError unless `value` is a Uint8Array (or subclass) NOT backed by a SharedArrayBuffer. */
export function assertPlainBytes(value: unknown, what: string): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${what} must be a Uint8Array`);
  }
  if (typeof SharedArrayBuffer !== "undefined" && value.buffer instanceof SharedArrayBuffer) {
    throw new TypeError(`${what} must not be backed by a SharedArrayBuffer`);
  }
}

/**
 * Independent owned copy as a PLAIN Uint8Array with its own exact ArrayBuffer.
 * Deliberately not `bytes.slice()`: for pool-backed Node subclasses that call
 * returns a VIEW over shared memory, which would still alias the caller's data.
 */
export function snapshot(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}
