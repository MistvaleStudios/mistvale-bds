import { BLOCK_PERMUTATIONS } from "@serenityjs/data";

import { BlockState } from "../src/registry/block-state";

import type { BlockStateValues } from "../src/registry/block-state";

// Recomputes every vanilla block state hash and compares it to the data set
let mismatched = 0;

for (const entry of BLOCK_PERMUTATIONS) {
  const computed = BlockState.hash(
    entry.identifier,
    (entry.state ?? {}) as BlockStateValues
  );

  if (computed === entry.hash) continue;

  // Print the first handful of mismatches so the cause is easy to spot
  if (mismatched < 5) {
    console.log(
      "mismatch",
      entry.identifier,
      JSON.stringify(entry.state),
      computed,
      entry.hash
    );
  }

  mismatched++;
}

console.log(`checked ${BLOCK_PERMUTATIONS.length}, mismatched ${mismatched}`);
process.exit(mismatched === 0 ? 0 : 1);
