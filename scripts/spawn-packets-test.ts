import { DeviceOS, MemoryTier, SerializedSkin } from "@serenityjs/protocol";

import { MistvaleServer } from "../src/server";
import { Player } from "../src/entity/player";
import { ResourcePackListener } from "../src/network/listeners/resource-packs";
import { Registries } from "../src/registry/registries";
import { Logger, LogLevel } from "../src/core/logger";

import type { DataPacket } from "@serenityjs/protocol";
import type { Session } from "../src/network/session";
import type { PlayerIdentity } from "../src/entity/identity";

// Every packet the join sequence sends must serialize. A field left null
// that the writer dereferences only fails at this point, never at build time.
const failures: Array<string> = [];

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

console.log("\nplayer list across multiple players");

// The add record is what a second player receives when someone joins
serializes("PlayerListPacket for another player", () =>
  other.createPlayerListAddPacket()
);

console.log(
  failures.length === 0
    ? "\nall checks passed"
    : `\n${failures.length} check(s) failed: ${failures.join(", ")}`
);

process.exit(failures.length === 0 ? 0 : 1);
