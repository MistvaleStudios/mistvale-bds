import { Packet } from "@serenityjs/protocol";

import { PacketListener } from "../listener";
import { SessionStage } from "../session";

import type { SetLocalPlayerAsInitializedPacket } from "@serenityjs/protocol";
import type { Session } from "../session";

class PlayerInitializedListener extends PacketListener {
  public static override readonly packet = Packet.SetLocalPlayerAsInitialized;

  public handle(
    packet: SetLocalPlayerAsInitializedPacket,
    session: Session
  ): void {
    const player = session.player;
    if (!player) return;

    // A mismatched runtime id means the client is confused about who it is
    if (packet.runtimeEntityId !== player.runtimeId) {
      return session.disconnect("Entity runtime id mismatch.");
    }

    session.stage = SessionStage.Playing;
    player.spawn();

    this.server.logger.info(
      `§u${player.username}§r spawned in §u${player.realm.identifier}§r at §7${Math.floor(player.position.x)}, ${Math.floor(player.position.y)}, ${Math.floor(player.position.z)}§r.`
    );
  }
}

export { PlayerInitializedListener };
