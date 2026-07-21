import {
  ContainerId,
  ContainerName,
  FullContainerName,
  InventoryContentPacket,
  InventorySlotPacket,
  MobEquipmentPacket
} from "@serenityjs/protocol";

import { ItemStack } from "./item-stack";

import type { Player } from "../entity/player";

// How many slots a player's inventory holds, hotbar included
const INVENTORY_SIZE = 36;

// How many of those slots make up the hotbar
const HOTBAR_SIZE = 9;

class Inventory {
  // The player this inventory belongs to
  public readonly player: Player;

  // The stacks held in each slot, where an empty slot holds nothing
  public readonly slots: Array<ItemStack | null>;

  // The hotbar slot the player currently has selected
  public selectedSlot = 0;

  public constructor(player: Player, size = INVENTORY_SIZE) {
    this.player = player;
    this.slots = new Array<ItemStack | null>(size).fill(null);
  }

  // How many slots this inventory holds
  public get size(): number {
    return this.slots.length;
  }

  // The stack in the given slot, if the slot exists and holds anything
  public getItem(slot: number): ItemStack | null {
    return this.slots[slot] ?? null;
  }

  // Places a stack into a slot, syncing the change to the client
  public setItem(slot: number, stack: ItemStack | null, sync = true): void {
    // Writes outside the inventory would silently grow the slot array
    if (slot < 0 || slot >= this.size) return;

    // An emptied stack is stored as nothing, so slots stay comparable
    this.slots[slot] = stack && !stack.isEmpty() ? stack : null;

    if (sync) this.player.send(this.createSlotPacket(slot));
  }

  // The stack the player is currently holding
  public getHeldItem(): ItemStack | null {
    return this.getItem(this.selectedSlot);
  }

  // Selects a hotbar slot, ignoring anything outside the hotbar
  public setSelectedSlot(slot: number): void {
    if (slot < 0 || slot >= HOTBAR_SIZE) return;

    this.selectedSlot = slot;
  }

  // Finds the first slot holding nothing, preferring the hotbar
  public getFirstEmptySlot(): number {
    // The hotbar comes first so picked items land somewhere reachable
    for (let slot = 0; slot < this.size; slot++) {
      if (!this.slots[slot]) return slot;
    }

    return -1;
  }

  // Builds the packet describing every slot at once
  public createContentPacket(): InventoryContentPacket {
    const packet = new InventoryContentPacket();
    packet.containerId = ContainerId.Inventory;
    packet.fullContainerName = new FullContainerName(ContainerName.Inventory);
    packet.storageItem = ItemStack.empty();

    packet.items = this.slots.map((stack) =>
      stack ? stack.toNetworkDescriptor() : ItemStack.empty()
    );

    return packet;
  }

  // Builds the packet describing a single slot
  public createSlotPacket(slot: number): InventorySlotPacket {
    const stack = this.getItem(slot);

    const packet = new InventorySlotPacket();
    packet.containerId = ContainerId.Inventory;
    packet.slot = slot;
    packet.fullContainerName = new FullContainerName(ContainerName.Inventory);
    packet.storageItem = ItemStack.empty();
    packet.item = stack ? stack.toNetworkDescriptor() : ItemStack.empty();

    return packet;
  }

  // Builds the packet telling other clients what this player is holding
  public createEquipmentPacket(): MobEquipmentPacket {
    const stack = this.getHeldItem();

    const packet = new MobEquipmentPacket();
    packet.runtimeEntityId = this.player.runtimeId;
    packet.item = stack ? stack.toNetworkDescriptor() : ItemStack.empty();
    packet.slot = this.selectedSlot;
    packet.selectedSlot = this.selectedSlot;
    packet.containerId = ContainerId.Inventory;

    return packet;
  }
}

export { Inventory, INVENTORY_SIZE, HOTBAR_SIZE };
