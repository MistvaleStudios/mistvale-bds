import {
  ContainerName,
  DeviceOS,
  FullContainerName,
  Gamemode,
  ItemStackRequest,
  ItemStackRequestAction,
  ItemStackRequestActionCraftCreative,
  ItemStackActionTakePlace,
  ItemStackRequestActionType,
  ItemStackRequestPacket,
  ItemStackRequestSlotInfo,
  ItemStackResponsePacket,
  ItemStackResponseContainerInfo,
  ItemStackResponseResult,
  MemoryTier,
  Packet,
  SerializedSkin
} from "@serenityjs/protocol";

import { MistvaleServer } from "../src/server";
import { Player } from "../src/entity/player";
import { CreativeRegistry } from "../src/registry/creative";
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

// Builds a slot reference the way the client addresses containers
function slotOf(container: ContainerName, slot: number): ItemStackRequestSlotInfo {
  return new ItemStackRequestSlotInfo(new FullContainerName(container), slot, 0);
}

// Wraps a craft creative action, which stages an item from the menu
function craftCreative(index: number, amount: number): ItemStackRequestAction {
  const action = new ItemStackRequestAction(
    ItemStackRequestActionType.CraftCreative
  );

  return Object.assign(action, {
    craftCreative: new ItemStackRequestActionCraftCreative(index, amount)
  });
}

// Wraps a take action, which moves an amount between two slots
function take(
  amount: number,
  source: ItemStackRequestSlotInfo,
  destination: ItemStackRequestSlotInfo
): ItemStackRequestAction {
  const action = new ItemStackRequestAction(ItemStackRequestActionType.Take);

  return Object.assign(action, {
    takeOrPlace: new ItemStackActionTakePlace(
      amount,
      source,
      destination
    )
  });
}

Logger.level = LogLevel.Warn;

const server = new MistvaleServer({
  port: 19_139,
  levelName: "requests",
  generator: "flat"
});

// Captures what the server sends back so the responses can be inspected
const outbound: Array<DataPacket> = [];
const session = {
  send: (...packets: Array<DataPacket>) => outbound.push(...packets),
  sendImmediate: (...packets: Array<DataPacket>) => outbound.push(...packets),
  player: null
} as unknown as Session;

const player = new Player(
  session,
  createIdentity("Tester"),
  server.level.overworld,
  1n,
  1n
);
player.spawned = true;
player.gamemode = Gamemode.Creative;

// The listener resolves the player from the session, as the gateway does
session.player = player;

const listener = server.gateway.dispatcher;

// Sends a request through the real listener and returns the response
function send(...actions: Array<ItemStackRequestAction>) {
  outbound.length = 0;

  const packet = new ItemStackRequestPacket();
  packet.requests = [new ItemStackRequest(1, actions, [], 0)];

  listener.dispatch(Packet.ItemStackRequest, packet, session);

  return outbound[0] as ItemStackResponsePacket;
}

console.log("\npicking an item out of the creative menu");

// This is the exact sequence the client sends when a creative item is
// clicked: stage it in the creative output, then take it onto the cursor.
const entry = CreativeRegistry.getEntry(0)!;

const response = send(
  craftCreative(0, 64),
  take(
    64,
    slotOf(ContainerName.CreativeOutput, 0),
    slotOf(ContainerName.Cursor, 0)
  )
);

const info = response?.responses[0];

check("a response is sent", info !== undefined);
check(
  "the request succeeds",
  info?.result === ItemStackResponseResult.Success,
  info?.result === ItemStackResponseResult.Error ? "rejected" : ""
);
check(
  "the item reaches the cursor",
  player.cursor?.type.identifier === entry.type.identifier,
  player.cursor?.type.identifier ?? "empty"
);
check("the cursor holds the full stack", player.cursor?.amount === 64, `${player.cursor?.amount}`);
check("the staging slot is emptied", player.creativeOutput === null);

// The client resyncs per container, so both must be described separately
const containers = (info?.containers ?? []).map(
  (container: ItemStackResponseContainerInfo) =>
    container.fullContainerName.identifier
);

check(
  "the response describes the cursor",
  containers.includes(ContainerName.Cursor),
  containers.map((name: ContainerName) => ContainerName[name]).join(", ")
);
check(
  "the response describes the creative output",
  containers.includes(ContainerName.CreativeOutput),
  containers.map((name: ContainerName) => ContainerName[name]).join(", ")
);

console.log("\nplacing the held item into the hotbar");

const placed = send(
  take(64, slotOf(ContainerName.Cursor, 0), slotOf(ContainerName.Hotbar, 0))
);

check(
  "the placement succeeds",
  placed?.responses[0]?.result === ItemStackResponseResult.Success
);
check(
  "the item lands in the hotbar",
  player.inventory.getItem(0)?.type.identifier === entry.type.identifier,
  player.inventory.getItem(0)?.type.identifier ?? "empty"
);
check("the cursor is emptied", player.cursor === null);
check(
  "the held item is the placed block",
  player.inventory.getHeldItem()?.type.identifier === entry.type.identifier
);

console.log("\nrejections");

// A survival player must not be able to conjure items
player.gamemode = Gamemode.Survival;
const survival = send(craftCreative(0, 1));

check(
  "a survival player cannot craft creative",
  survival?.responses[0]?.result === ItemStackResponseResult.Error
);

player.gamemode = Gamemode.Creative;
const bogus = send(craftCreative(CreativeRegistry.size + 10, 1));

check(
  "an unknown creative index is rejected",
  bogus?.responses[0]?.result === ItemStackResponseResult.Error
);

console.log(
  failures.length === 0
    ? "\nall checks passed"
    : `\n${failures.length} check(s) failed: ${failures.join(", ")}`
);

process.exit(failures.length === 0 ? 0 : 1);
