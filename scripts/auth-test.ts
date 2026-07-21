import { Authentication } from "@bedrock-apis/carolina-authentication";

import "../src/core/polyfill";

// Exercises the authentication library paths the login listener depends on,
// which are the ones that reach for Uint8Array.fromBase64
const failures: Array<string> = [];

function check(name: string, condition: boolean, detail = ""): void {
  console.log(`  ${condition ? "pass" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
  if (!condition) failures.push(name);
}

console.log("\nauthentication library");

// A JWT shaped token whose payload uses the base64url alphabet
const payload = {
  extraData: { displayName: "Plotsy", identity: "abc-123" },
  identityPublicKey: "KEY"
};
const header = Buffer.from('{"alg":"ES384"}').toString("base64url");
const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
const token = `${header}.${body}.signature`;

// split is used by both the offline and online paths
const segments = Authentication.split(token);
check("split returns three segments", segments.length === 3);

// partialParse is one of the three fromBase64 call sites in the library
try {
  const parsed = Authentication.partialParse<typeof payload>(segments[1]);

  check(
    "partialParse decodes a base64url payload",
    parsed.extraData.displayName === "Plotsy",
    parsed.extraData.displayName
  );
} catch (error) {
  check("partialParse decodes a base64url payload", false, String(error));
}

// parse is the very first call the login listener makes
try {
  const wrapped = Authentication.parse(
    JSON.stringify({
      AuthenticationType: 2,
      Token: String(),
      Certificate: '{"chain":[]}'
    })
  );

  check("parse reads an identity envelope", wrapped.AuthenticationType === 2);
} catch (error) {
  check("parse reads an identity envelope", false, String(error));
}

// verify runs the base64 decode before it ever reaches the crypto, so a
// rejection here must come from the signature rather than the polyfill
void Authentication.verify(token, Buffer.from("not-a-real-key").toString("base64"))
  .then(() => {
    check("verify rejects an unsigned token", false, "resolved unexpectedly");
  })
  .catch((error: Error) => {
    const decodeFailure = error.message.includes("fromBase64");

    check(
      "verify fails on crypto, not on base64 decoding",
      !decodeFailure,
      error.message.slice(0, 70)
    );
  })
  .finally(() => {
    console.log(
      failures.length === 0
        ? "\nall checks passed"
        : `\n${failures.length} check(s) failed: ${failures.join(", ")}`
    );

    process.exit(failures.length === 0 ? 0 : 1);
  });
