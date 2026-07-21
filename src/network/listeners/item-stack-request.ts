import {
  ContainerName,
  FullContainerName,
  ItemStackRequestActionType,
  ItemStackResponseContainerInfo,
  ItemStackResponseInfo,
  ItemStackResponsePacket,
  ItemStackResponseResult,
  ItemStackResponseSlotInfo,
  Packet
} from "@serenityjs/protocol";

import { ItemStack } from "../../item/item-stack";
import { CreativeRegistry } from "../../registry/creative";
import { PacketListener } from "../listener";

import type {
  ItemStackRequest,
  ItemStackRequestAction,
  ItemStackRequestPacket,
  ItemStackRequestSlotInfo
} from "@serenityjs/protocol";
import type { Player } from "../../entity/player";
import type { Inventory } from "../../item/inventory";
import type { Session } from "../session";

class ItemStackRequestListener extends PacketListener {
  public static override readonly packet = Packet.ItemStackRequest;

  public handle(packet: ItemStackRequestPacket, session: Session): void {
    const player = session.player;
    if (!player || !player.spawned) return;

    // Each request is answered independently, so one failure cannot stall
    // the others and leave the client waiting on a response forever
    const response = new ItemStackResponsePacket();
    response.responses = packet.requests.map((request) =>
      this.resolve(request, player)
    );

    session.send(response);
  }

  // Applies one request and describes the slots it touched
  private resolve(
    request: ItemStackRequest,
    player: Player
  ): ItemStackResponseInfo {
    // The client tracks which slots it must resync from the response
    const touched = new Set<number>();

    // An unsupported action leaves the client's prediction wrong, so the
    // whole request is rejected rather than partly applied
    for (const action of request.actions) {
      if (this.apply(action, player, touched)) continue;

      return new ItemStackResponseInfo(
        ItemStackResponseResult.Error,
        request.clientRequestId,
        []
      );
    }

    return new ItemStackResponseInfo(
      ItemStackResponseResult.Success,
      request.clientRequestId,
      [this.describe(player.inventory, touched)]
    );
  }

  // Applies a single action, returning whether it was understood
  private apply(
    action: ItemStackRequestAction,
    player: Player,
    touched: Set<number>
  ): boolean {
    switch (action.action) {
      case ItemStackRequestActionType.CraftCreative: {
        return this.craftCreative(action, player);
      }

      case ItemStackRequestActionType.Take:
      case ItemStackRequestActionType.Place: {
        return this.takeOrPlace(action, player, touched);
      }

      case ItemStackRequestActionType.Swap: {
        return this.swap(action, player, touched);
      }

      case ItemStackRequestActionType.Destroy:
      case ItemStackRequestActionType.Drop: {
        return this.destroy(action, player, touched);
      }

      // The results action only echoes what the client already predicted
      case ItemStackRequestActionType.CraftResults_DEPRECATEDASKTYLAING: {
        return true;
      }

      default: {
        this.server.logger.debug(
          `Unhandled item stack action §u${ItemStackRequestActionType[action.action] ?? action.action}§r.`
        );

        return false;
      }
    }
  }

  // Stages the item a creative player picked out of the menu
  private craftCreative(
    action: ItemStackRequestAction,
    player: Player
  ): boolean {
    const request = action.craftCreative;
    if (!request) return false;

    // An index the menu never handed out cannot be honoured
    const entry = CreativeRegistry.getEntry(request.creativeIndex);
    if (!entry) {
      this.server.logger.debug(
        `§u${player.username}§r requested unknown creative index §u${request.creativeIndex}§r.`
      );

      return false;
    }

    // The item is held until a following place action says where it goes
    player.cursor = ItemStack.fromCreative(
      entry,
      request.amount || entry.descriptor.stackSize || 1
    );

    return true;
  }

  // Moves an amount between two slots, which may include the cursor
  private takeOrPlace(
    action: ItemStackRequestAction,
    player: Player,
    touched: Set<number>
  ): boolean {
    const request = action.takeOrPlace;
    if (!request) return false;

    const source = this.read(request.source, player, touched);
    const destination = this.read(request.destination, player, touched);

    // Slots outside the containers this server models cannot be moved
    if (source === undefined || destination === undefined) return false;

    // Taking from an empty slot is a desync rather than a legal move
    if (!source.stack) return false;

    const amount = Math.min(request.amount, source.stack.amount);
    const moved = source.stack.clone(amount);

    // Merge into the destination when it already holds the same item
    if (destination.stack) {
      if (!destination.stack.matches(moved)) return false;

      destination.stack.amount = Math.min(
        destination.stack.amount + amount,
        destination.stack.maxAmount
      );

      this.write(request.destination, player, destination.stack, touched);
    } else {
      this.write(request.destination, player, moved, touched);
    }

    // Then take the moved amount out of the source
    const remaining = source.stack.amount - amount;
    this.write(
      request.source,
      player,
      remaining > 0 ? source.stack.clone(remaining) : null,
      touched
    );

    return true;
  }

  // Exchanges the contents of two slots
  private swap(
    action: ItemStackRequestAction,
    player: Player,
    touched: Set<number>
  ): boolean {
    const request = action.swap;
    if (!request) return false;

    const source = this.read(request.source, player, touched);
    const destination = this.read(request.destination, player, touched);

    if (source === undefined || destination === undefined) return false;

    this.write(request.source, player, destination.stack, touched);
    this.write(request.destination, player, source.stack, touched);

    return true;
  }

  // Clears a slot, which covers both destroying and dropping for now
  private destroy(
    action: ItemStackRequestAction,
    player: Player,
    touched: Set<number>
  ): boolean {
    const request = action.destroyOrConsume ?? action.drop;
    if (!request) return false;

    const source = this.read(request.source, player, touched);
    if (source === undefined) return false;

    // Only the requested amount leaves the slot
    const remaining = (source.stack?.amount ?? 0) - request.amount;
    this.write(
      request.source,
      player,
      remaining > 0 && source.stack ? source.stack.clone(remaining) : null,
      touched
    );

    return true;
  }

  // Reads the stack a slot reference points at, or undefined if unsupported
  private read(
    info: ItemStackRequestSlotInfo,
    player: Player,
    touched: Set<number>
  ): { stack: ItemStack | null } | undefined {
    switch (info.container.identifier) {
      case ContainerName.Cursor: {
        return { stack: player.cursor };
      }

      case ContainerName.Hotbar:
      case ContainerName.Inventory:
      case ContainerName.HotbarAndInventory: {
        touched.add(info.slot);

        return { stack: player.inventory.getItem(info.slot) };
      }

      default: {
        this.server.logger.debug(
          `Unhandled container §u${ContainerName[info.container.identifier] ?? info.container.identifier}§r.`
        );

        return undefined;
      }
    }
  }

  // Writes a stack into the slot a reference points at
  private write(
    info: ItemStackRequestSlotInfo,
    player: Player,
    stack: ItemStack | null,
    touched: Set<number>
  ): void {
    if (info.container.identifier === ContainerName.Cursor) {
      player.cursor = stack;

      return;
    }

    touched.add(info.slot);

    // The response already tells the client about the slot, so sending a
    // separate slot packet here would make it resync twice
    player.inventory.setItem(info.slot, stack, false);
  }

  // Describes the slots a request touched, so the client can resync them
  private describe(
    inventory: Inventory,
    touched: Set<number>
  ): ItemStackResponseContainerInfo {
    const slots = [...touched].map((slot) => {
      const stack = inventory.getItem(slot);

      return new ItemStackResponseSlotInfo(
        slot,
        stack?.amount ?? 0,
        stack?.stackId ?? 0,
        String(),
        String(),
        0
      );
    });

    return new ItemStackResponseContainerInfo(
      new FullContainerName(ContainerName.Inventory),
      slots
    );
  }
}

export { ItemStackRequestListener };
