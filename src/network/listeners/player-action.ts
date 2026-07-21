import { Gamemode, Packet, PlayerActionType } from "@serenityjs/protocol";

import { PacketListener } from "../listener";

import type { PlayerActionPacket } from "@serenityjs/protocol";
import type { Player } from "../../entity/player";
import type { Session } from "../session";

class PlayerActionListener extends PacketListener {
  public static override readonly packet = Packet.PlayerAction;

  public handle(packet: PlayerActionPacket, session: Session): void {
    const player = session.player;
    if (!player || !player.spawned) return;

    // A client may only act as itself
    if (packet.entityRuntimeId !== player.runtimeId) return;

    switch (packet.action) {
      // A creative player breaks a block in a single click
      case PlayerActionType.CreativeDestroyBlock: {
        return this.destroy(packet, player, true);
      }

      // Everyone else finishes a break they had been holding
      case PlayerActionType.StopDestroyBlock:
      case PlayerActionType.PredictDestroyBlock: {
        return this.destroy(packet, player, false);
      }

      // Breaking progress is client driven for now, so these need no action
      case PlayerActionType.StartDestroyBlock:
      case PlayerActionType.AbortDestroyBlock:
      case PlayerActionType.ContinueDestroyBlock: {
        return;
      }

      default: {
        this.server.logger.debug(
          `Unhandled player action §u${PlayerActionType[packet.action] ?? packet.action}§r from §u${player.username}§r.`
        );
      }
    }
  }

  // Removes the block the action targeted
  private destroy(
    packet: PlayerActionPacket,
    player: Player,
    creativeOnly: boolean
  ): void {
    const creative =
      player.gamemode === Gamemode.Creative ||
      player.gamemode === Gamemode.CreativeSpectator;

    // The creative path must not let a survival player break instantly
    if (creativeOnly && !creative) return;

    // Spectators may not change the world at all
    if (player.gamemode === Gamemode.Spectator) return;

    const { x, y, z } = packet.blockPosition;

    // Breaking air is a desync rather than a real break
    if (player.realm.isReplaceable(x, y, z)) return;

    player.realm.destroyBlock(x, y, z);
  }
}

export { PlayerActionListener };
