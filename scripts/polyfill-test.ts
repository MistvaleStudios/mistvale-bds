import { installUint8ArrayBase64 } from "../src/core/polyfill";

// The polyfill installs on import, so this only proves it is idempotent
installUint8ArrayBase64();

const failures: Array<string> = [];

// Records the result of a single named check
function check(name: string, condition: boolean, detail = ""): void {
  console.log(`  ${condition ? "pass" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
  if (!condition) failures.push(name);
}

// Asserts that a call throws, which the lenient Buffer decoders do not
function throws(name: string, action: () => unknown): void {
  try {
    action();
    check(name, false, "did not throw");
  } catch {
    check(name, true);
  }
}

console.log("\nbase64 decoding");

// The standard alphabet, as used for the identity public key
const key = Buffer.from("hello mistvale").toString("base64");
check(
  "decodes standard base64",
  Buffer.from(Uint8Array.fromBase64(key)).toString() === "hello mistvale"
);

// The url alphabet, as used for every JWT segment
const payload = JSON.stringify({ extraData: { displayName: "Plotsy" } });
const encoded = Buffer.from(payload).toString("base64url");
check(
  "decodes base64url",
  Buffer.from(
    Uint8Array.fromBase64(encoded, { alphabet: "base64url" })
  ).toString() === payload
);

// A payload whose base64url form contains the substituted characters
const tricky = Buffer.from([0xfb, 0xef, 0xbe, 0xff, 0xfe]);
const trickyEncoded = tricky.toString("base64url");
check(
  "handles the url alphabet substitutions",
  Buffer.from(
    Uint8Array.fromBase64(trickyEncoded, { alphabet: "base64url" })
  ).equals(tricky),
  trickyEncoded
);

// Unpadded input is what JWT segments actually look like
check(
  "decodes unpadded input",
  Uint8Array.fromBase64("aGVsbG8", { alphabet: "base64url" }).length === 5
);

console.log("\ninput validation");

// Buffer.from silently ignores junk, which would let malformed tokens pass
throws("rejects characters outside the alphabet", () =>
  Uint8Array.fromBase64("not valid base64!!")
);

throws("rejects url characters in the standard alphabet", () =>
  Uint8Array.fromBase64("aGVsbG8-_w")
);

throws("rejects an incomplete trailing chunk", () =>
  Uint8Array.fromBase64("a")
);

throws("rejects an unknown alphabet", () =>
  Uint8Array.fromBase64("aGVsbG8=", {
    alphabet: "base32" as unknown as "base64"
  })
);

throws("rejects invalid hex", () => Uint8Array.fromHex("zzzz"));

console.log("\nencoding and round trips");

const bytes = new Uint8Array([0, 1, 127, 128, 255, 254]);

check("encodes to base64", bytes.toBase64() === Buffer.from(bytes).toString("base64"));
check(
  "encodes to base64url",
  bytes.toBase64({ alphabet: "base64url" }) ===
    Buffer.from(bytes).toString("base64url")
);
check("encodes to hex", bytes.toHex() === "00017f80fffe");
check(
  "round trips through base64",
  Buffer.from(Uint8Array.fromBase64(bytes.toBase64())).equals(Buffer.from(bytes))
);
check(
  "round trips through hex",
  Buffer.from(Uint8Array.fromHex(bytes.toHex())).equals(Buffer.from(bytes))
);

// A view into a larger buffer must not leak its neighbours
const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
const view = backing.subarray(2, 5);
check("encodes a subarray view correctly", view.toHex() === "010203", view.toHex());

console.log("\nin place writes");

const target = new Uint8Array(4);
const result = target.setFromHex("deadbeef");
check("setFromHex writes the bytes", target.toHex() === "deadbeef");
check("setFromHex reports what it wrote", result.written === 4, `${result.written}`);

const small = new Uint8Array(2);
small.setFromBase64("aGVsbG8=");
check("setFromBase64 truncates to the target", small.toHex() === "6865", small.toHex());

console.log(
  failures.length === 0
    ? "\nall checks passed"
    : `\n${failures.length} check(s) failed: ${failures.join(", ")}`
);

process.exit(failures.length === 0 ? 0 : 1);
