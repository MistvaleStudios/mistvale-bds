import { AnimateListener } from "./animate";
import { ChunkRadiusListener } from "./chunk-radius";
import { DisconnectListener } from "./disconnect";
import { LoginListener } from "./login";
import { NetworkSettingsListener } from "./network-settings";
import { PlayerInitializedListener } from "./player-initialized";
import { PlayerInputListener } from "./player-input";
import { ResourcePackListener } from "./resource-packs";

import type { PacketListenerClass } from "../listener";

// Every listener registered with the dispatcher on boot
const LISTENERS: Array<PacketListenerClass> = [
  NetworkSettingsListener,
  LoginListener,
  ResourcePackListener,
  ChunkRadiusListener,
  PlayerInitializedListener,
  PlayerInputListener,
  AnimateListener,
  DisconnectListener
];

export {
  LISTENERS,
  AnimateListener,
  ChunkRadiusListener,
  DisconnectListener,
  LoginListener,
  NetworkSettingsListener,
  PlayerInitializedListener,
  PlayerInputListener,
  ResourcePackListener
};
