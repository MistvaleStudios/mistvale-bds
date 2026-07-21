import {
  BlockFace,
  BlockPosition,
  ComplexInventoryTransaction,
  DeviceOS,
  Gamemode,
  InventoryTransaction,
  InventoryTransactionPacket,
  ItemUseInventoryTransaction,
  ItemUseInventoryTransactionType,
  MemoryTier,
  Packet,
  PlayerActionPacket,
  PlayerActionType,
  SerializedSkin,
  Vector3f
} from "@serenityjs/protocol";

import { MistvaleServer } from "../src/server";
import { Player } from "../src/entity/player";
import { ItemStack } from "../src/item/item-stack";
import { ItemType } from "../src/registry/item-type";
import { Chunk } from "../src/level/chunk";
import { offsetByFace } from "../src/level/block-face";
import { Logger, LogLevel } from "../src/core/logger";

import type { DataPacket } from "@serenityjs/protocol";
import type { Session } from "../src/network/session";
import type { PlayerIdentity } from "../src/entity/identity";

const failures: Array<string> = [];

// Records the result of a single named check
function check(name: string, condition: boolean, detail = ""): void {
  console.log(`  ${condition ? "pass" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
  if (!condition) failures.push(name);
}

// Builds an identity resembling what a real login would produce
function createIdentity(username: string): PlayerIdentity {
  return {
    username,
    xuid: "2535000000000000",
    uuid: "00000000-0000-3000-8000-000000000000",
    skin: SerializedSkin.empty(),
    device: {
      id: "test",
      model: "Test",
      os: DeviceOS.Win10,
      maxViewDistance: 16,
      memoryTier: MemoryTier.SuperHigh
    }
  };
}

Logger.level = LogLevel.Warn;

const server = new MistvaleServer({
  port: 19_141,
  levelName: "placement",
  generator: "flat"
});

const outbound: Array<DataPacket> = [];
const session = {
  send: (...packets: Array<DataPacket>) => outbound.push(...packets),
  sendImmediate: (...packets: Array<DataPacket>) => outbound.push(...packets),
  player: null
} as unknown as Session;

const player = new Player(
  session,
  createIdentity("Builder"),
  server.level.overworld,
  1n,
  1n
);
player.spawned = true;
player.gamemode = Gamemode.Creative;
session.player = player;

// spawn() is what normally registers a player with its realm, and broadcasts
// only reach registered players, so the test has to do it here
player.realm.addPlayer(player);

const realm = player.realm;
const dispatcher = server.gateway.dispatcher;

// Sends the transaction a client sends when it places a block
function placeAgainst(position: BlockPosition, face: BlockFace) {
  outbound.length = 0;

  const use = new ItemUseInventoryTransaction(
    ItemUseInventoryTransactionType.Place,
    0,
    position,
    face,
    player.inventory.selectedSlot,
    player.inventory.getHeldItem()?.toNetworkDescriptor() ?? ItemStack.empty(),
    new Vector3f(0, 0, 0),
    new Vector3f(0.5, 0.5, 0.5),
    0,
    0,
    0
  );

  const packet = new InventoryTransactionPacket();
  packet.transaction = new InventoryTransaction(
    ComplexInventoryTransaction.ItemUseTransaction,
    [],
    use,
    null,
    null
  );

  dispatcher.dispatch(Packet.InventoryTransaction, packet, session);
}

// Sends the action a client sends when it breaks a block
function breakAt(position: BlockPosition, action: PlayerActionType) {
  outbound.length = 0;

  const packet = new PlayerActionPacket();
  packet.entityRuntimeId = player.runtimeId;
  packet.action = action;
  packet.blockPosition = position;
  packet.resultPosition = position;
  packet.face = BlockFace.Top;

  dispatcher.dispatch(Packet.PlayerAction, packet, session);
}

console.log("\nplacing a block");

// The flat world puts grass at -61, so the surface is a solid face to click
const surface = new BlockPosition(4, -61, 4);
const raised = offsetByFace(surface, BlockFace.Top);
const above = new BlockPosition(raised.x, raised.y, raised.z);

check(
  "the clicked face is solid",
  !realm.isReplaceable(surface.x, surface.y, surface.z),
  realm.getState(surface.x, surface.y, surface.z).identifier
);
check(
  "the target starts empty",
  realm.isReplaceable(above.x, above.y, above.z)
);

// Give the player a stack of stone to place
const stone = ItemType.get("minecraft:stone")!;
player.inventory.setItem(0, new ItemStack(stone, { amount: 64 }), false);
player.inventory.setSelectedSlot(0);

placeAgainst(surface, BlockFace.Top);

check(
  "the block lands above the clicked face",
  realm.getState(above.x, above.y, above.z).identifier === "minecraft:stone",
  realm.getState(above.x, above.y, above.z).identifier
);
check(
  "the clicked block is untouched",
  realm.getState(surface.x, surface.y, surface.z).identifier ===
    "minecraft:grass_block"
);
check(
  "the placement is broadcast",
  outbound.some((packet) => packet.constructor.name.startsWith("UpdateBlockPacket")),
  outbound.map((packet) => packet.constructor.name).join(", ")
);
check(
  "a creative stack is not consumed",
  player.inventory.getItem(0)?.amount === 64,
  `${player.inventory.getItem(0)?.amount}`
);

console.log("\nplacing on every face");

// Each face must offset in its own direction, or blocks land inside walls
const centre = new BlockPosition(8, -61, 8);
const faces: Array<[string, BlockFace]> = [
  ["north", BlockFace.North],
  ["south", BlockFace.South],
  ["west", BlockFace.West],
  ["east", BlockFace.East],
  ["top", BlockFace.Top]
];

for (const [name, face] of faces) {
  const target = offsetByFace(centre, face);

  // Clear anything left from an earlier iteration
  realm.destroyBlock(target.x, target.y, target.z);
  placeAgainst(centre, face);

  check(
    `placing against the ${name} face lands correctly`,
    realm.getState(target.x, target.y, target.z).identifier === "minecraft:stone",
    `${target.x}, ${target.y}, ${target.z}`
  );
}

console.log("\nrefusals");

// Placing into an occupied space must be refused, not silently overwrite
const occupied = new BlockPosition(4, -62, 4);
const before = realm.getState(occupied.x, occupied.y, occupied.z).identifier;
placeAgainst(new BlockPosition(4, -63, 4), BlockFace.Top);

check(
  "an occupied target is not overwritten",
  realm.getState(occupied.x, occupied.y, occupied.z).identifier === before,
  before
);

// An empty hand has nothing to place
player.inventory.setItem(0, null, false);
const emptyTarget = new BlockPosition(6, -60, 6);
placeAgainst(new BlockPosition(6, -61, 6), BlockFace.Top);

check(
  "an empty hand places nothing",
  realm.isReplaceable(emptyTarget.x, emptyTarget.y, emptyTarget.z)
);

console.log("\nbreaking a block");

// Creative breaks instantly
breakAt(above, PlayerActionType.CreativeDestroyBlock);

check(
  "a creative break clears the block",
  realm.isReplaceable(above.x, above.y, above.z),
  realm.getState(above.x, above.y, above.z).identifier
);
check(
  "the break is broadcast",
  outbound.some((packet) => packet.constructor.name.startsWith("UpdateBlockPacket"))
);

// A survival player must not break through the creative path
player.gamemode = Gamemode.Survival;
const survivalTarget = new BlockPosition(12, -61, 12);
breakAt(survivalTarget, PlayerActionType.CreativeDestroyBlock);

check(
  "survival cannot use the creative break",
  !realm.isReplaceable(survivalTarget.x, survivalTarget.y, survivalTarget.z),
  realm.getState(survivalTarget.x, survivalTarget.y, survivalTarget.z).identifier
);

// But it may finish a normal break
breakAt(survivalTarget, PlayerActionType.StopDestroyBlock);

check(
  "survival can finish a normal break",
  realm.isReplaceable(survivalTarget.x, survivalTarget.y, survivalTarget.z)
);

// A spectator may not change the world at all
player.gamemode = Gamemode.Spectator;
const spectatorTarget = new BlockPosition(14, -61, 14);
breakAt(spectatorTarget, PlayerActionType.StopDestroyBlock);

check(
  "a spectator cannot break blocks",
  !realm.isReplaceable(spectatorTarget.x, spectatorTarget.y, spectatorTarget.z)
);

console.log("\nsurvival consumes the stack");

player.gamemode = Gamemode.Survival;
player.inventory.setItem(0, new ItemStack(stone, { amount: 2 }), false);

const survivalPlace = new BlockPosition(16, -61, 16);
placeAgainst(survivalPlace, BlockFace.Top);

check(
  "a survival placement consumes one item",
  player.inventory.getItem(0)?.amount === 1,
  `${player.inventory.getItem(0)?.amount}`
);

placeAgainst(new BlockPosition(18, -61, 18), BlockFace.Top);

check("the slot empties when the stack runs out", player.inventory.getItem(0) === null);

console.log("\nplaced blocks survive chunk reserialization");

// A player arriving later receives the chunk, not the block updates, so a
// stale serialization cache would hand them a world missing every edit
player.gamemode = Gamemode.Creative;
player.inventory.setItem(0, new ItemStack(stone, { amount: 64 }), false);

const chunk = realm.getChunk(0, 0);
const beforeBuffer = Chunk.serialize(chunk);

const marker = new BlockPosition(1, -60, 1);
placeAgainst(new BlockPosition(1, -61, 1), BlockFace.Top);

const afterBuffer = Chunk.serialize(chunk);

check(
  "the serialized chunk changes after a placement",
  !beforeBuffer.equals(afterBuffer),
  `${beforeBuffer.byteLength} then ${afterBuffer.byteLength} bytes`
);

// Reading it back is what a joining client effectively does
const restored = Chunk.deserialize(
  0,
  0,
  chunk.dimension,
  afterBuffer,
  chunk.getSectionSendCount()
);

check(
  "the placed block is present in the reserialized chunk",
  restored.getState(marker.x & 0xf, marker.y, marker.z & 0xf).identifier ===
    "minecraft:stone",
  restored.getState(marker.x & 0xf, marker.y, marker.z & 0xf).identifier
);

console.log(
  failures.length === 0
    ? "\nall checks passed"
    : `\n${failures.length} check(s) failed: ${failures.join(", ")}`
);

process.exit(failures.length === 0 ? 0 : 1);
