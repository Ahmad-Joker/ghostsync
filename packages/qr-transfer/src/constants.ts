/** Frame format version. A different digit means a different, incompatible frame. */
export const QR_FRAME_VERSION = 1;
export const QR_FRAME_PREFIX = "GSQ1:";
/** Largest capsule the static code carries: (1853 - 5) / 3 groups x 2 bytes. */
export const QR_MAX_CAPSULE_BYTES = 1232;
/** Version 25, level L, alphanumeric capacity. */
export const QR_MAX_FRAME_CHARS = 1853;
export const QR_ECC_LEVEL = "L";
export const QR_MAX_VERSION = 25;
