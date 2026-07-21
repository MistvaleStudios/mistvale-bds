import { createSocket } from "node:dgram";

import { DimensionType, Packet } from "@serenityjs/protocol";

import { MistvaleServer } from "../src/server";
import { Chunk } from "../src/level/chunk";
import { BlockState } from "../src/registry/block-state";
import { BlockType } from "../src/registry/block-type";
import { ItemType } from "../src/registry/item-type";
import { Registries } from "../src/registry/registries";
import { Logger, LogLevel } from "../src/core/logger";

// The magic sequence every RakNet offline message carries
const RAKNET_MAGIC = Buffer.from(
  "00ffff00fefefefefdfdfdfd12345678",
  "hex"
);

// The port the smoke test binds the server to
const TEST_PORT = 19_137;

// Tracks the outcome of each check so the exit code can reflect them
const failures: Array<string> = [];

// Records the result of a single named check
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  pass  ${name}${detail ? ` (${detail})` : ""}`);

    return;
  }

  console.log(`  FAIL  ${name}${detail ? ` (${detail})` : ""}`);
  failures.push(name);
}

// Verifies the registries loaded the full vanilla data set
function testRegistries(): void {
  console.log("\nregistries");

  Registries.load();

  check("block types registered", BlockType.types.size > 1300, `${BlockType.types.size}`);
  check("block states registered", BlockState.states.size > 16_000, `${BlockState.states.size}`);
  check("item types registered", ItemType.types.size > 1600, `${ItemType.types.size}`);

  // Air must resolve, since every empty storage is filled with it
  const air = BlockType.get("minecraft:air");
  check("air block type resolves", air !== null);
  check("air state hash matches registry", air?.defaultState.networkId === BlockState.air().networkId);

  // A block with several state properties exercises the state lookup path
  const stone = BlockType.get("minecraft:stone");
  check("stone block type resolves", stone !== null);
  check("stone has at least one state", (stone?.states.length ?? 0) > 0);

  // Every state must be reachable by its own hash
  let unreachable = 0;
  for (const state of BlockState.states.values()) {
    if (BlockState.resolve(state.networkId) !== state) unreachable++;
  }
  check("every block state resolves by hash", unreachable === 0, `${unreachable} unreachable`);

  // The registry packets are what the client actually consumes
  const items = Registries.getItemRegistry();
  check("item registry serializes", items.definitions.length > 1600, `${items.definitions.length} definitions`);

  const biomes = Registries.getBiomeDefinitions();
  check("biome definitions serialize", biomes.definitions.length > 80, `${biomes.definitions.length} biomes`);
}

// Verifies chunks survive a serialization round trip intact
function testChunkRoundTrip(): void {
  console.log("\nchunk serialization");

  const bedrock = BlockType.get("minecraft:bedrock")!.defaultState;
  const dirt = BlockType.get("minecraft:dirt")!.defaultState;
  const grass = BlockType.get("minecraft:grass_block")!.defaultState;

  // Build a flat chunk by hand so the expected contents are known exactly
  const chunk = new Chunk(0, 0, DimensionType.Overworld);
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      chunk.setState(x, -64, z, bedrock);
      chunk.setState(x, -63, z, dirt);
      chunk.setState(x, -62, z, dirt);
      chunk.setState(x, -61, z, grass);
    }
  }
  chunk.fillBiome(1);

  const count = chunk.getSectionSendCount();
  const buffer = Chunk.serialize(chunk);

  check("chunk reports sections to send", count === 1, `${count} sections`);
  check("chunk serializes to a payload", buffer.byteLength > 0, `${buffer.byteLength} bytes`);

  // Reading the payload back must reproduce the exact same blocks
  const restored = Chunk.deserialize(0, 0, DimensionType.Overworld, buffer, count);

  let mismatches = 0;
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      for (let y = -64; y < -48; y++) {
        if (restored.getState(x, y, z).networkId !== chunk.getState(x, y, z).networkId) {
          mismatches++;
        }
      }
    }
  }

  check("round trip preserves every block", mismatches === 0, `${mismatches} mismatched`);
  check("round trip preserves the surface", restored.getState(0, -61, 0).identifier === "minecraft:grass_block");
  check("round trip preserves the floor", restored.getState(0, -64, 0).identifier === "minecraft:bedrock");
  check("round trip preserves air above", restored.getState(0, -50, 0).identifier === "minecraft:air");

  // A chunk holding many distinct states exercises the wider bit packings
  const wide = new Chunk(1, 0, DimensionType.Overworld);
  const states = [...BlockState.states.values()].slice(0, 300);
  for (let index = 0; index < 256; index++) {
    wide.setState(index & 0xf, -64, index >> 4, states[index % states.length]);
  }

  const wideCount = wide.getSectionSendCount();
  const wideRestored = Chunk.deserialize(
    1,
    0,
    DimensionType.Overworld,
    Chunk.serialize(wide),
    wideCount
  );

  let wideMismatches = 0;
  for (let index = 0; index < 256; index++) {
    const x = index & 0xf;
    const z = index >> 4;
    if (
      wideRestored.getState(x, -64, z).networkId !==
      wide.getState(x, -64, z).networkId
    ) {
      wideMismatches++;
    }
  }

  check("wide palette round trips", wideMismatches === 0, `${wideMismatches} mismatched`);
}

// Verifies the generated world matches what the flat generator promises
function testGeneration(server: MistvaleServer): void {
  console.log("\nworld generation");

  const realm = server.level.overworld;
  const chunk = realm.getChunk(0, 0);

  check("overworld realm exists", realm !== null);
  check("generated chunk has content", !chunk.isEmpty());
  check("floor is bedrock", realm.getState(0, -64, 0).identifier === "minecraft:bedrock");
  check("subsoil is dirt", realm.getState(0, -63, 0).identifier === "minecraft:dirt");
  check("surface is grass", realm.getState(0, -61, 0).identifier === "minecraft:grass_block");
  check("above surface is air", realm.getState(0, -60, 0).identifier === "minecraft:air");
  check("spawn sits above the surface", realm.spawn.y === -60, `y=${realm.spawn.y}`);

  // Chunks far from the origin must generate the same way
  const distant = realm.getChunk(120, -75);
  check(
    "distant chunk generates",
    distant.getState(0, -61, 0).identifier === "minecraft:grass_block"
  );
}

// Verifies every packet the join and play loop relies on has a listener
function testListeners(server: MistvaleServer): void {
  console.log("\npacket listeners");

  // A listener that exists but was never added to LISTENERS silently does
  // nothing, which looks identical to the feature not being implemented
  const required: Array<[string, Packet]> = [
    ["RequestNetworkSettings", Packet.RequestNetworkSettings],
    ["Login", Packet.Login],
    ["ResourcePackClientResponse", Packet.ResourcePackClientResponse],
    ["RequestChunkRadius", Packet.RequestChunkRadius],
    ["SetLocalPlayerAsInitialized", Packet.SetLocalPlayerAsInitialized],
    ["PlayerAuthInput", Packet.PlayerAuthInput],
    ["Animate", Packet.Animate],
    ["ItemStackRequest", Packet.ItemStackRequest],
    ["MobEquipment", Packet.MobEquipment],
    ["Disconnect", Packet.Disconnect]
  ];

  for (const [name, packet] of required) {
    check(`${name} has a listener`, server.gateway.dispatcher.handles(packet));
  }
}

// Verifies the server answers a RakNet unconnected ping over a real socket
function testRaknetPing(server: MistvaleServer): Promise<void> {
  console.log("\nraknet transport");

  return new Promise((resolve) => {
    const socket = createSocket("udp4");

    // Give up rather than hanging the whole test run
    const timer = setTimeout(() => {
      check("server answers an unconnected ping", false, "timed out");
      socket.close();
      resolve();
    }, 3000);

    socket.on("message", (message) => {
      clearTimeout(timer);

      // An unconnected pong carries the server's advertisement string
      check("server answers an unconnected ping", message[0] === 0x1c, `id 0x${message[0].toString(16)}`);

      const advert = message.subarray(35).toString("utf8");
      check("advertisement names MCPE", advert.startsWith("MCPE;"), advert.split(";").slice(0, 4).join(";"));
      check("advertisement carries the motd", advert.includes(server.config.motd));
      check("advertisement carries the protocol", advert.includes(";1001;"));

      socket.close();
      resolve();
    });

    // Build the unconnected ping the client sends when browsing servers
    const ping = Buffer.alloc(33);
    ping.writeUInt8(0x01, 0);
    ping.writeBigUInt64BE(BigInt(Date.now()), 1);
    RAKNET_MAGIC.copy(ping, 9);
    ping.writeBigUInt64BE(1n, 25);

    socket.send(ping, TEST_PORT, "127.0.0.1");
  });
}

async function main(): Promise<void> {
  // Keep the server's own logging out of the test output
  Logger.level = LogLevel.Warn;

  testRegistries();
  testChunkRoundTrip();

  const server = new MistvaleServer({
    port: TEST_PORT,
    motd: "Mistvale Smoke Test",
    levelName: "smoke",
    generator: "flat"
  });

  testGeneration(server);
  testListeners(server);

  server.start();
  await testRaknetPing(server);
  server.stop();

  console.log(
    failures.length === 0
      ? "\nall checks passed"
      : `\n${failures.length} check(s) failed: ${failures.join(", ")}`
  );

  process.exit(failures.length === 0 ? 0 : 1);
}

void main();
