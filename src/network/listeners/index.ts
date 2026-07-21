import { AnimateListener } from "./animate";
import { ChunkRadiusListener } from "./chunk-radius";
import { ContainerCloseListener } from "./container-close";
import { DisconnectListener } from "./disconnect";
import { InteractListener } from "./interact";
import { InventoryTransactionListener } from "./inventory-transaction";
import { ItemStackRequestListener } from "./item-stack-request";
import { LoginListener } from "./login";
import { MobEquipmentListener } from "./mob-equipment";
import { NetworkSettingsListener } from "./network-settings";
import { PlayerActionListener } from "./player-action";
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
  InteractListener,
  InventoryTransactionListener,
  PlayerActionListener,
  ItemStackRequestListener,
  MobEquipmentListener,
  ContainerCloseListener,
  DisconnectListener
];

export {
  LISTENERS,
  AnimateListener,
  ChunkRadiusListener,
  ContainerCloseListener,
  InteractListener,
  InventoryTransactionListener,
  ItemStackRequestListener,
  MobEquipmentListener,
  PlayerActionListener,
  DisconnectListener,
  LoginListener,
  NetworkSettingsListener,
  PlayerInitializedListener,
  PlayerInputListener,
  ResourcePackListener
};
