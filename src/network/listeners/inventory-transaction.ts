import {
  BlockPosition,
  ComplexInventoryTransaction,
  Gamemode,
  ItemUseInventoryTransactionType,
  Packet,
  UpdateBlockFlagsType,
  UpdateBlockLayerType,
  UpdateBlockPacket
} from "@serenityjs/protocol";

import { offsetByFace } from "../../level/block-face";
import { PacketListener } from "../listener";

import type {
  InventoryTransactionPacket,
  IPosition,
  ItemUseInventoryTransaction
} from "@serenityjs/protocol";
import type { Player } from "../../entity/player";
import type { Session } from "../session";

class InventoryTransactionListener extends PacketListener {
  public static override readonly packet = Packet.InventoryTransaction;

  public handle(packet: InventoryTransactionPacket, session: Session): void {
    const player = session.player;
    if (!player || !player.spawned) return;

    const { transaction } = packet;

    // Only item use transactions place or break blocks
    if (transaction.type !== ComplexInventoryTransaction.ItemUseTransaction) {
      return;
    }

    const use = transaction.itemUse;
    if (!use) return;

    switch (use.type) {
      case ItemUseInventoryTransactionType.Place: {
        return this.place(use, player);
      }

      case ItemUseInventoryTransactionType.Destroy: {
        return this.destroy(use, player);
      }

      default: {
        this.server.logger.debug(
          `Unhandled item use §u${ItemUseInventoryTransactionType[use.type] ?? use.type}§r from §u${player.username}§r.`
        );
      }
    }
  }

  // Places the held block against the face the player clicked
  private place(use: ItemUseInventoryTransaction, player: Player): void {
    const { realm } = player;
    const clicked = use.blockPosition;

    // Clicking air means the client and server disagree about the world
    if (realm.isReplaceable(clicked.x, clicked.y, clicked.z)) {
      return this.revert(player, clicked);
    }

    // The held item is the authority on what is being placed, not the packet
    const held = player.inventory.getHeldItem();
    const blockType = held?.type.properties.blockType ?? null;

    // Nothing to place when the hand is empty or holding a non block item
    if (!held || !blockType) return this.revert(player, clicked);

    // The block goes against the clicked face, not into the clicked block
    const target = offsetByFace(clicked, use.face);

    // Something already occupies the target, so the prediction was wrong
    if (!realm.isReplaceable(target.x, target.y, target.z)) {
      return this.revert(player, target);
    }

    // The auxiliary value selects which state of the block is placed
    const state = blockType.states[held.metadata] ?? blockType.defaultState;

    realm.updateBlock(target.x, target.y, target.z, state);

    // Creative players place from an inexhaustible stack
    if (
      player.gamemode === Gamemode.Creative ||
      player.gamemode === Gamemode.CreativeSpectator
    ) {
      return;
    }

    // Everyone else spends one item, emptying the slot when it runs out
    held.amount--;
    player.inventory.setItem(
      player.inventory.selectedSlot,
      held.isEmpty() ? null : held
    );
  }

  // Breaks the block a creative player clicked
  private destroy(use: ItemUseInventoryTransaction, player: Player): void {
    const position = use.blockPosition;

    // Only creative players break instantly through this path
    if (
      player.gamemode !== Gamemode.Creative &&
      player.gamemode !== Gamemode.CreativeSpectator
    ) {
      return;
    }

    player.realm.destroyBlock(position.x, position.y, position.z);
  }

  // Tells the client what a position really holds, undoing its prediction
  private revert(player: Player, position: IPosition): void {
    const state = player.realm.getState(position.x, position.y, position.z);

    const packet = new UpdateBlockPacket();
    packet.position = new BlockPosition(position.x, position.y, position.z);
    packet.networkBlockId = state.networkId;
    packet.layer = UpdateBlockLayerType.Normal;
    packet.flags = UpdateBlockFlagsType.Network;

    player.send(packet);

    // The held stack may also have been predicted away, so resend it
    player.send(
      player.inventory.createSlotPacket(player.inventory.selectedSlot)
    );
  }
}

export { InventoryTransactionListener };
