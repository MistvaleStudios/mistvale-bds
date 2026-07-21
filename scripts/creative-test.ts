import { CREATIVE_CONTENT, CREATIVE_GROUPS } from "@serenityjs/data";
import { CreativeContentPacket } from "@serenityjs/protocol";

import { CreativeRegistry } from "../src/registry/creative";
import { Registries } from "../src/registry/registries";
import { ItemStack } from "../src/item/item-stack";
import { BlockType } from "../src/registry/block-type";
import { ItemType } from "../src/registry/item-type";
import { Logger, LogLevel } from "../src/core/logger";

const failures: Array<string> = [];

// Records the result of a single named check
function check(name: string, condition: boolean, detail = ""): void {
  console.log(`  ${condition ? "pass" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
  if (!condition) failures.push(name);
}

Logger.level = LogLevel.Warn;
Registries.load();
CreativeRegistry.load();

console.log("\ncreative registry");

check(
  "entries registered",
  CreativeRegistry.size > 1800,
  `${CreativeRegistry.size} of ${CREATIVE_CONTENT.length}`
);

const packet = CreativeRegistry.getContentPacket();

check(
  "groups match the data set",
  packet.groups.length === CREATIVE_GROUPS.length,
  `${packet.groups.length}`
);
check(
  "items match the registered entries",
  packet.items.length === CreativeRegistry.size,
  `${packet.items.length}`
);
check("content packet serializes", packet.serialize().byteLength > 0);

// A packet the client cannot parse is indistinguishable from one it ignores,
// so read our own output back with the protocol's own reader
try {
  const decoded = new CreativeContentPacket(packet.serialize()).deserialize();

  check(
    "content packet round trips",
    decoded.groups.length === packet.groups.length &&
      decoded.items.length === packet.items.length,
    `${decoded.groups.length} groups, ${decoded.items.length} items`
  );
  check(
    "the first item survives the round trip",
    decoded.items[0]?.itemInstance.network === packet.items[0]?.itemInstance.network
  );
} catch (error) {
  check("content packet round trips", false, (error as Error).message);
}

console.log("\ncreative index mapping");

// The client picks an item by the index the packet gave it, so the entry at
// that index must be the same item the packet advertised. An off by one here
// hands out the wrong block and is invisible until someone places one.
let misaligned = 0;
for (const [index, item] of packet.items.entries()) {
  if (item.itemIndex !== index) {
    misaligned++;
    continue;
  }

  const entry = CreativeRegistry.getEntry(index);
  if (!entry || entry.descriptor.network !== item.itemInstance.network) {
    misaligned++;
  }
}

check(
  "every advertised index resolves to the same item",
  misaligned === 0,
  `${misaligned} misaligned`
);

// Every entry must point at a group the packet actually contains
let orphaned = 0;
for (let index = 0; index < CreativeRegistry.size; index++) {
  const entry = CreativeRegistry.getEntry(index)!;
  if (entry.groupIndex < 0 || entry.groupIndex >= packet.groups.length) {
    orphaned++;
  }
}

check("every entry belongs to a real group", orphaned === 0, `${orphaned} orphaned`);

// Out of range indices must not resolve, since the client controls them
check("negative index resolves to nothing", CreativeRegistry.getEntry(-1) === null);
check(
  "index past the end resolves to nothing",
  CreativeRegistry.getEntry(CreativeRegistry.size) === null
);

console.log("\ncreative item stacks");

// A block picked out of the menu must carry a placeable block state
const planks = CreativeRegistry.getEntry(0);
check("the first entry resolves", planks !== null, planks?.type.identifier);

if (planks) {
  const stack = ItemStack.fromCreative(planks, 64);

  check("stack takes the requested amount", stack.amount === 64);
  check("stack is not empty", !stack.isEmpty());
  check("stack serializes", stack.toNetworkDescriptor().network === planks.type.networkId);
  // A non zero id is not enough. Resolving to the wrong state would place
  // the wrong block, so it must match both the registry and the vanilla data.
  const block = BlockType.get(planks.type.identifier);

  check(
    "block state matches the block registry",
    stack.networkBlockId === block?.defaultState.networkId,
    `${stack.networkBlockId} vs ${block?.defaultState.networkId}`
  );
  check(
    "block state matches the vanilla descriptor",
    stack.networkBlockId === planks.descriptor.networkBlockId,
    `${planks.descriptor.networkBlockId}`
  );
}

// Every block item in the menu must resolve to a state the client knows
let unresolvable = 0;
for (let index = 0; index < CreativeRegistry.size; index++) {
  const entry = CreativeRegistry.getEntry(index)!;

  // Only entries that actually place a block are expected to carry a state
  if (!entry.type.isBlock) continue;

  const stack = ItemStack.fromCreative(entry, 1);
  if (stack.networkBlockId === 0) unresolvable++;
}

check(
  "every block item resolves a block state",
  unresolvable === 0,
  `${unresolvable} unresolvable`
);

// A non block item must not claim to place anything
const stick = ItemType.get("minecraft:stick");
check("stick item type resolves", stick !== null);

if (stick) {
  const stack = new ItemStack(stick, { amount: 1 });
  check("a non block item has no block state", stack.networkBlockId === 0);
}

// Stacks holding the same thing merge, different things do not
if (planks) {
  const a = ItemStack.fromCreative(planks, 1);
  const b = ItemStack.fromCreative(planks, 1);

  check("identical stacks match", a.matches(b));
  check("stack ids are unique", a.stackId !== b.stackId);

  if (stick) {
    check("different stacks do not match", !a.matches(new ItemStack(stick)));
  }
}

console.log(
  failures.length === 0
    ? "\nall checks passed"
    : `\n${failures.length} check(s) failed: ${failures.join(", ")}`
);

process.exit(failures.length === 0 ? 0 : 1);
