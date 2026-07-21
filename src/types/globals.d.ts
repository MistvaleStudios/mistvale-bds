// Ambient declarations for the Uint8Array base64 and hex conversion methods.
// These are a TC39 proposal that only ships natively in Node 25, and are
// installed by src/core/polyfill.ts on runtimes that lack them.

// The alphabets the base64 conversion methods accept
type Uint8ArrayBase64Alphabet = "base64" | "base64url";

// How the final, possibly incomplete, chunk of input is treated
type Uint8ArrayLastChunkHandling = "loose" | "strict" | "stop-before-partial";

// The options bag both base64 directions accept
interface Uint8ArrayBase64Options {
  alphabet?: Uint8ArrayBase64Alphabet;
  lastChunkHandling?: Uint8ArrayLastChunkHandling;
}

// What an in place write reports back to its caller
interface Uint8ArrayWriteResult {
  read: number;
  written: number;
}

interface Uint8ArrayConstructor {
  // Decodes a base64 or base64url string into a new array
  fromBase64(
    input: string,
    options?: Uint8ArrayBase64Options
  ): Uint8Array<ArrayBuffer>;

  // Decodes a hex string into a new array
  fromHex(input: string): Uint8Array<ArrayBuffer>;
}

interface Uint8Array<TArrayBuffer extends ArrayBufferLike = ArrayBufferLike> {
  // Encodes the array as a base64 or base64url string
  toBase64(options?: Uint8ArrayBase64Options): string;

  // Encodes the array as a lowercase hex string
  toHex(): string;

  // Decodes into this array, writing only as many bytes as fit
  setFromBase64(
    input: string,
    options?: Uint8ArrayBase64Options
  ): Uint8ArrayWriteResult;

  // Decodes hex into this array, writing only as many bytes as fit
  setFromHex(input: string): Uint8ArrayWriteResult;
}
