// The alphabets the base64 conversion methods accept
type Base64Alphabet = "base64" | "base64url";

// How the final, possibly incomplete, chunk of input is treated
type LastChunkHandling = "loose" | "strict" | "stop-before-partial";

// The options bag both base64 directions accept
interface Base64Options {
  alphabet?: Base64Alphabet;
  lastChunkHandling?: LastChunkHandling;
}

// The shape of the methods this module installs when they are missing
interface Uint8ArrayBase64Statics {
  fromBase64?(input: string, options?: Base64Options): Uint8Array;
  fromHex?(input: string): Uint8Array;
}

interface Uint8ArrayBase64Methods {
  toBase64?(options?: Base64Options): string;
  toHex?(): string;
  setFromBase64?(input: string, options?: Base64Options): {
    read: number;
    written: number;
  };
  setFromHex?(input: string): { read: number; written: number };
}

// Characters valid in each alphabet, used to reject malformed input
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9\-_]*={0,2}$/;
const HEX_PATTERN = /^(?:[0-9a-fA-F]{2})*$/;

// Decodes a base64 or base64url string into bytes
function decodeBase64(input: string, options: Base64Options = {}): Uint8Array {
  const alphabet = options.alphabet ?? "base64";

  // The specification only defines these two alphabets
  if (alphabet !== "base64" && alphabet !== "base64url") {
    throw new TypeError(`Unsupported base64 alphabet "${alphabet}".`);
  }

  // Trailing whitespace is common in tokens, so trim before validating
  const trimmed = input.trim();

  // Node's decoder silently ignores invalid characters, which would let a
  // malformed token through, so reject anything outside the alphabet first
  const pattern =
    alphabet === "base64url" ? BASE64URL_PATTERN : BASE64_PATTERN;

  if (!pattern.test(trimmed)) {
    throw new SyntaxError(`Input is not a valid ${alphabet} string.`);
  }

  // A strict caller expects complete four character chunks
  const unpadded = trimmed.replace(/=+$/, "");
  if (
    options.lastChunkHandling === "strict" &&
    trimmed.length % 4 !== 0
  ) {
    throw new SyntaxError("Input is not padded to a multiple of four.");
  }

  // A single leftover character can never form a byte
  if (unpadded.length % 4 === 1) {
    throw new SyntaxError("Input has an incomplete trailing chunk.");
  }

  // Node's base64 decoder accepts both alphabets, so decode directly
  const buffer = Buffer.from(unpadded, "base64");

  return new Uint8Array(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    )
  );
}

// Encodes bytes into a base64 or base64url string
function encodeBase64(bytes: Uint8Array, options: Base64Options = {}): string {
  const alphabet = options.alphabet ?? "base64";

  if (alphabet !== "base64" && alphabet !== "base64url") {
    throw new TypeError(`Unsupported base64 alphabet "${alphabet}".`);
  }

  // Node's base64url encoding already omits the padding the spec drops
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    alphabet === "base64url" ? "base64url" : "base64"
  );
}

// Decodes a hex string into bytes
function decodeHex(input: string): Uint8Array {
  // Node's hex decoder stops at the first invalid pair rather than throwing
  if (!HEX_PATTERN.test(input)) {
    throw new SyntaxError("Input is not a valid hex string.");
  }

  const buffer = Buffer.from(input, "hex");

  return new Uint8Array(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    )
  );
}

// Installs the Uint8Array base64 and hex methods when the runtime lacks them
function installUint8ArrayBase64(): void {
  const statics = Uint8Array as unknown as Uint8ArrayBase64Statics;
  const methods = Uint8Array.prototype as unknown as Uint8ArrayBase64Methods;

  // These landed in Node 25, so newer runtimes already provide them natively
  if (typeof statics.fromBase64 !== "function") {
    statics.fromBase64 = (input, options) => decodeBase64(input, options);
  }

  if (typeof statics.fromHex !== "function") {
    statics.fromHex = (input) => decodeHex(input);
  }

  if (typeof methods.toBase64 !== "function") {
    methods.toBase64 = function toBase64(options) {
      return encodeBase64(this as unknown as Uint8Array, options);
    };
  }

  if (typeof methods.toHex !== "function") {
    methods.toHex = function toHex() {
      const bytes = this as unknown as Uint8Array;

      return Buffer.from(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength
      ).toString("hex");
    };
  }

  if (typeof methods.setFromBase64 !== "function") {
    methods.setFromBase64 = function setFromBase64(input, options) {
      const target = this as unknown as Uint8Array;
      const decoded = decodeBase64(input, options);

      // Only as many bytes as fit are written, matching the specification
      const written = Math.min(decoded.length, target.length);
      target.set(decoded.subarray(0, written));

      return { read: input.length, written };
    };
  }

  if (typeof methods.setFromHex !== "function") {
    methods.setFromHex = function setFromHex(input) {
      const target = this as unknown as Uint8Array;
      const decoded = decodeHex(input);

      const written = Math.min(decoded.length, target.length);
      target.set(decoded.subarray(0, written));

      return { read: input.length, written };
    };
  }
}

// Applied on import, since dependencies may reach for these at module scope
installUint8ArrayBase64();

export { installUint8ArrayBase64, Base64Options, Base64Alphabet };
