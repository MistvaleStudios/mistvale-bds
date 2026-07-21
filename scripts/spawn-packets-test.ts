import {
  ActorDataId,
  ActorFlag,
  AttributeName,
  DeviceOS,
  MemoryTier,
  SerializedSkin
} from "@serenityjs/protocol";

import { MistvaleServer } from "../src/server";
import { EYE_HEIGHT, Player } from "../src/entity/player";
import { ResourcePackListener } from "../src/network/listeners/resource-packs";
import { Registries } from "../src/registry/registries";
import { Logger, LogLevel } from "../src/core/logger";

import type { DataPacket } from "@serenityjs/protocol";
import type { Session } from "../src/network/session";
import type { PlayerIdentity } from "../src/entity/identity";

// Every packet the join sequence sends must serialize. A field left null
// that the writer dereferences only fails at this point, never at build time.
const failures: Array<string> = [];

// Records the result of a single named check
function check(name: string, condition: boolean, detail = ""): void {
  console.log(`  ${condition ? "pass" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
  if (!condition) failures.push(name);
}

// Serializes a packet and records whether it survived the round trip
function serializes(name: string, build: () => DataPacket): void {
  try {
    const packet = build();
    const buffer = packet.serialize();

    if (buffer.byteLength === 0) {
      console.log(`  FAIL  ${name} (serialized to zero bytes)`);
      failures.push(name);

      return;
    }

    console.log(`  pass  ${name} (${buffer.byteLength} bytes)`);
  } catch (error) {
    console.log(`  FAIL  ${name} (${(error as Error).message})`);
    failures.push(name);
  }
}

// Builds an identity resembling what a real login would produce
function createIdentity(username: string): PlayerIdentity {
  return {
    username,
    xuid: "2535000000000000",
    uuid: "00000000-0000-3000-8000-000000000000",
    skin: SerializedSkin.empty(),
    device: {
      id: "test-device",
      model: "Test",
      os: DeviceOS.Win10,
      maxViewDistance: 16,
      memoryTier: MemoryTier.SuperHigh
    }
  };
}

Logger.level = LogLevel.Warn;
Registries.load();

const server = new MistvaleServer({
  port: 19_138,
  levelName: "packets",
  generator: "flat"
});

// The player never sends anything here, so a stub session is enough
const stub = { send: () => {}, sendImmediate: () => {} } as unknown as Session;

const player = new Player(
  stub,
  createIdentity("Wimziicals"),
  server.level.overworld,
  1n,
  1n
);

const other = new Player(
  stub,
  createIdentity("SecondPlayer"),
  server.level.overworld,
  2n,
  2n
);

console.log("\njoin sequence packets");

serializes("StartGamePacket", () =>
  ResourcePackListener.createStartGamePacket(player)
);
serializes("ItemRegistryPacket", () => Registries.getItemRegistry());
serializes("BiomeDefinitionListPacket", () => Registries.getBiomeDefinitions());

console.log("\nspawn packets");

serializes("PlayerListPacket (add)", () => player.createPlayerListAddPacket());
serializes("PlayerListPacket (remove)", () =>
  player.createPlayerListRemovePacket()
);
serializes("UpdateAbilitiesPacket", () => player.createAbilitiesPacket());
serializes("SetPlayerGameTypePacket", () => player.createGamemodePacket());
serializes("CreativeContentPacket", () =>
  Player.createCreativeContentPacket()
);

console.log("\nvisibility and movement packets");

serializes("SetActorDataPacket", () => player.createActorDataPacket());
serializes("AddPlayerPacket", () => player.createAddPlayerPacket());
serializes("MoveActorDeltaPacket", () => player.createMovePacket());
serializes("RemoveEntityPacket", () => player.createRemoveEntityPacket());
serializes("UpdateAttributesPacket", () => player.createAttributesPacket());

console.log("\nplayer list across multiple players");

// The add record is what a second player receives when someone joins
serializes("PlayerListPacket for another player", () =>
  other.createPlayerListAddPacket()
);
serializes("AddPlayerPacket for another player", () =>
  other.createAddPlayerPacket()
);

console.log("\nrender offsets");

// Other clients position the model from its collision height. Sending the raw
// feet position sinks the model into the ground by roughly its own height.
const move = player.createMovePacket();
check(
  "movement broadcast is offset by the collision height",
  Math.abs(move.y - (player.position.y + EYE_HEIGHT)) < 0.001,
  `y=${move.y} from feet ${player.position.y}`
);

// The add packet is the exception, taking the feet position directly
const add = player.createAddPlayerPacket();
check(
  "add packet uses the feet position",
  Math.abs(add.position.y - player.position.y) < 0.001,
  `y=${add.position.y}`
);

console.log("\nattributes");

const attributes = player.createAttributesPacket();
const movement = attributes.attributes.find(
  (attribute) => attribute.name === AttributeName.Movement
);

check("movement attribute is sent", movement !== undefined);
check(
  "movement attribute matches the walk speed",
  movement?.current === 0.1,
  `${movement?.current}`
);
check(
  "health attribute is sent",
  attributes.attributes.some(
    (attribute) => attribute.name === AttributeName.Health
  )
);

console.log("\nsneaking");

check("player starts standing", !player.isSneaking());

player.setSneaking(true);
check("sneaking sets the flag", player.isSneaking());

const crouched = player.metadata
  .toDataItems()
  .find((item) => item.identifier === ActorDataId.BoundingBoxHeight);
check(
  "sneaking shrinks the collision box",
  crouched?.value === 1.5,
  `${crouched?.value}`
);

player.setSneaking(false);
const standing = player.metadata
  .toDataItems()
  .find((item) => item.identifier === ActorDataId.BoundingBoxHeight);
check(
  "standing restores the collision box",
  standing?.value === 1.8,
  `${standing?.value}`
);

console.log("\nmetadata");

// The flags must survive the packing into their reserved long fields
const items = player.metadata.toDataItems();
const flagField = items.find((item) => item.identifier === ActorDataId.Reserved0);
const flags = BigInt((flagField?.value as bigint) ?? 0n);

function hasFlag(flag: ActorFlag): boolean {
  return (flags & (1n << BigInt(flag % 64))) !== 0n;
}

check("metadata carries a flag field", flagField !== undefined);
check("breathing flag is packed", hasFlag(ActorFlag.Breathing));
check("collision flag is packed", hasFlag(ActorFlag.HasCollision));
check("gravity flag is packed", hasFlag(ActorFlag.HasGravity));
check("climb flag is packed", hasFlag(ActorFlag.CanClimb));
check(
  "bounding box is present",
  items.some((item) => item.identifier === ActorDataId.BoundingBoxHeight)
);
check(
  "name is present",
  items.some((item) => item.identifier === ActorDataId.Name)
);

// Flags at or above sixty four belong in the second reserved field
player.metadata.setFlag(70 as ActorFlag);
const wide = player.metadata.toDataItems();
check(
  "high flags land in the second field",
  wide.some((item) => item.identifier === ActorDataId.Reserved092)
);
player.metadata.setFlag(70 as ActorFlag, false);
check(
  "clearing a high flag drops the second field",
  !player.metadata
    .toDataItems()
    .some((item) => item.identifier === ActorDataId.Reserved092)
);

console.log(
  failures.length === 0
    ? "\nall checks passed"
    : `\n${failures.length} check(s) failed: ${failures.join(", ")}`
);

process.exit(failures.length === 0 ? 0 : 1);
