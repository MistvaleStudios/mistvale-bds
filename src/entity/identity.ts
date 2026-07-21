import { createHash } from "node:crypto";

import type { DeviceOS, MemoryTier, SerializedSkin } from "@serenityjs/protocol";

// Everything the server knows about a client from its login tokens
interface PlayerIdentity {
  // The display name shown to other players
  username: string;

  // The Xbox user id, or a derived stand-in when running offline
  xuid: string;

  // The stable uuid used to key persisted player data
  uuid: string;

  // The skin the client presented on login
  skin: SerializedSkin;

  // The device the client is playing on
  device: DeviceInfo;
}

// The hardware and platform details a client reports
interface DeviceInfo {
  // The opaque identifier the client reports for its device
  id: string;

  // The human readable device model
  model: string;

  // The platform the client is running on
  os: DeviceOS;

  // The furthest chunk radius the client is willing to render
  maxViewDistance: number;

  // The memory bracket the client reports
  memoryTier: MemoryTier;
}

// Derives the uuid Mojang assigns to an authenticated player
function uuidFromXuid(xuid: string): string {
  return uuidFromBytes(`pocket-auth-1-xuid:${xuid}`);
}

// Derives a stable uuid for a player connecting without Xbox authentication
function uuidFromUsername(username: string): string {
  return uuidFromBytes(`OfflinePlayer:${username}`);
}

// Derives a stable stand-in xuid for a player connecting without Xbox auth
function xuidFromUsername(username: string): string {
  // Hash the username so the same player always receives the same identifier
  const hash = createHash("sha256").update(`OfflineXUID:${username}`).digest();

  // Real xuids are sixteen digit numbers, so shape the output to match
  return hash.readBigUInt64BE(0).toString().padStart(16, "0").slice(0, 16);
}

// Builds a version three uuid from the given seed string
function uuidFromBytes(seed: string): string {
  const bytes = createHash("md5").update(new TextEncoder().encode(seed)).digest();

  // Stamp the version and variant bits the uuid specification requires
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  // Split the digest into the canonical five group layout
  const hex = bytes.toString("hex");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join("-");
}

export {
  PlayerIdentity,
  DeviceInfo,
  uuidFromXuid,
  uuidFromUsername,
  xuidFromUsername
};
