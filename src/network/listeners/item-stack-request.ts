import {
  ContainerName,
  FullContainerName,
  Gamemode,
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
import type { Session } from "../session";

// The slots a request touched, grouped by the container holding them. The
// client resyncs per container, so they cannot be lumped together.
type TouchedSlots = Map<ContainerName, Set<number>>;

// The single slot the cursor and staging containers each hold
const SINGLE_SLOT = 0;

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

  // Applies one request and describes every container it touched
  private resolve(
    request: ItemStackRequest,
    player: Player
  ): ItemStackResponseInfo {
    const touched: TouchedSlots = new Map();

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
      this.describe(player, touched)
    );
  }

  // Applies a single action, returning whether it was understood
  private apply(
    action: ItemStackRequestAction,
    player: Player,
    touched: TouchedSlots
  ): boolean {
    switch (action.action) {
      case ItemStackRequestActionType.CraftCreative: {
        return this.craftCreative(action, player, touched);
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

  // Stages the item a creative player picked into the creative output slot,
  // which a following take action then moves onto the cursor
  private craftCreative(
    action: ItemStackRequestAction,
    player: Player,
    touched: TouchedSlots
  ): boolean {
    const request = action.craftCreative;
    if (!request) return false;

    // Only a creative player may conjure items out of nothing
    if (
      player.gamemode !== Gamemode.Creative &&
      player.gamemode !== Gamemode.CreativeSpectator
    ) {
      this.server.logger.debug(
        `§u${player.username}§r requested a creative item outside creative mode.`
      );

      return false;
    }

    // An index the menu never handed out cannot be honoured
    const entry = CreativeRegistry.getEntry(request.creativeIndex);
    if (!entry) {
      this.server.logger.debug(
        `§u${player.username}§r requested unknown creative index §u${request.creativeIndex}§r.`
      );

      return false;
    }

    // The client may ask for more than the item is allowed to stack to
    const stack = ItemStack.fromCreative(
      entry,
      request.amount || entry.descriptor.stackSize || 1
    );
    stack.amount = Math.min(stack.amount, stack.maxAmount);

    player.creativeOutput = stack;
    this.touch(touched, ContainerName.CreativeOutput, SINGLE_SLOT);

    return true;
  }

  // Moves an amount between two slots, in any supported container
  private takeOrPlace(
    action: ItemStackRequestAction,
    player: Player,
    touched: TouchedSlots
  ): boolean {
    const request = action.takeOrPlace;
    if (!request) return false;

    const source = this.read(request.source, player, touched);
    const destination = this.read(request.destination, player, touched);

    // Slots outside the containers this server models cannot be moved
    if (source === undefined || destination === undefined) return false;

    // Taking from an empty slot is a desync rather than a legal move
    if (!source) return false;

    const amount = Math.min(request.amount, source.amount);

    // Merge into the destination when it already holds the same item
    if (destination) {
      if (!destination.matches(source)) return false;

      destination.amount = Math.min(
        destination.amount + amount,
        destination.maxAmount
      );

      this.write(request.destination, player, destination, touched);
    } else {
      this.write(request.destination, player, source.clone(amount), touched);
    }

    // Then take the moved amount out of the source
    const remaining = source.amount - amount;
    this.write(
      request.source,
      player,
      remaining > 0 ? source.clone(remaining) : null,
      touched
    );

    return true;
  }

  // Exchanges the contents of two slots
  private swap(
    action: ItemStackRequestAction,
    player: Player,
    touched: TouchedSlots
  ): boolean {
    const request = action.swap;
    if (!request) return false;

    const source = this.read(request.source, player, touched);
    const destination = this.read(request.destination, player, touched);

    if (source === undefined || destination === undefined) return false;

    this.write(request.source, player, destination, touched);
    this.write(request.destination, player, source, touched);

    return true;
  }

  // Clears a slot, which covers both destroying and dropping for now
  private destroy(
    action: ItemStackRequestAction,
    player: Player,
    touched: TouchedSlots
  ): boolean {
    const request = action.destroyOrConsume ?? action.drop;
    if (!request) return false;

    const source = this.read(request.source, player, touched);
    if (source === undefined) return false;

    // Only the requested amount leaves the slot
    const remaining = (source?.amount ?? 0) - request.amount;
    this.write(
      request.source,
      player,
      remaining > 0 && source ? source.clone(remaining) : null,
      touched
    );

    return true;
  }

  // Reads the stack a slot reference points at. Null is an empty slot,
  // undefined is a container this server does not model.
  private read(
    info: ItemStackRequestSlotInfo,
    player: Player,
    touched: TouchedSlots
  ): ItemStack | null | undefined {
    const container = info.container.identifier;

    switch (container) {
      case ContainerName.Cursor: {
        this.touch(touched, container, SINGLE_SLOT);

        return player.cursor;
      }

      case ContainerName.CreativeOutput: {
        this.touch(touched, container, SINGLE_SLOT);

        return player.creativeOutput;
      }

      case ContainerName.Hotbar:
      case ContainerName.Inventory:
      case ContainerName.HotbarAndInventory: {
        this.touch(touched, container, info.slot);

        return player.inventory.getItem(info.slot);
      }

      default: {
        this.server.logger.debug(
          `Unhandled container §u${ContainerName[container] ?? container}§r.`
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
    touched: TouchedSlots
  ): void {
    const container = info.container.identifier;

    switch (container) {
      case ContainerName.Cursor: {
        player.cursor = stack;
        this.touch(touched, container, SINGLE_SLOT);

        return;
      }

      case ContainerName.CreativeOutput: {
        player.creativeOutput = stack;
        this.touch(touched, container, SINGLE_SLOT);

        return;
      }

      default: {
        this.touch(touched, container, info.slot);

        // The response already tells the client about the slot, so sending a
        // separate slot packet here would make it resync twice
        player.inventory.setItem(info.slot, stack, false);
      }
    }
  }

  // Records that a slot within a container needs resyncing
  private touch(
    touched: TouchedSlots,
    container: ContainerName,
    slot: number
  ): void {
    const slots = touched.get(container) ?? new Set<number>();
    slots.add(slot);

    touched.set(container, slots);
  }

  // Describes every container the request touched, so the client resyncs
  private describe(
    player: Player,
    touched: TouchedSlots
  ): Array<ItemStackResponseContainerInfo> {
    const infos: Array<ItemStackResponseContainerInfo> = [];

    for (const [container, slots] of touched) {
      const entries = [...slots].map((slot) => {
        const stack = this.peek(player, container, slot);

        return new ItemStackResponseSlotInfo(
          slot,
          stack?.amount ?? 0,
          stack?.stackId ?? 0,
          String(),
          String(),
          0
        );
      });

      infos.push(
        new ItemStackResponseContainerInfo(
          new FullContainerName(container),
          entries
        )
      );
    }

    return infos;
  }

  // Reads back whatever a slot holds now, for describing the result
  private peek(
    player: Player,
    container: ContainerName,
    slot: number
  ): ItemStack | null {
    switch (container) {
      case ContainerName.Cursor: {
        return player.cursor;
      }

      case ContainerName.CreativeOutput: {
        return player.creativeOutput;
      }

      default: {
        return player.inventory.getItem(slot);
      }
    }
  }
}

export { ItemStackRequestListener };
