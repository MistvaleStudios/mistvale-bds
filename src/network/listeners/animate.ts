import { Packet } from "@serenityjs/protocol";

import { PacketListener } from "../listener";

import type { AnimatePacket } from "@serenityjs/protocol";
import type { Session } from "../session";

class AnimateListener extends PacketListener {
  public static override readonly packet = Packet.Animate;

  public handle(packet: AnimatePacket, session: Session): void {
    const player = session.player;

    // Animations from a player who is not in the world have nobody to reach
    if (!player || !player.spawned) return;

    // A client may only animate itself, never some other entity
    if (packet.actorRuntimeId !== player.runtimeId) {
      return this.server.logger.debug(
        `§u${player.username}§r tried to animate entity §u${packet.actorRuntimeId}§r, ignoring.`
      );
    }

    // The sending client already played the animation locally
    player.realm.broadcastExcept(player, packet);
  }
}

export { AnimateListener };
