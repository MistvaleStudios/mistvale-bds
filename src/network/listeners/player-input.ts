import { Packet, Vector3f } from "@serenityjs/protocol";

import { EYE_HEIGHT } from "../../entity/player";
import { PacketListener } from "../listener";

import type { PlayerAuthInputPacket } from "@serenityjs/protocol";
import type { Session } from "../session";

class PlayerInputListener extends PacketListener {
  public static override readonly packet = Packet.PlayerAuthInput;

  public handle(packet: PlayerAuthInputPacket, session: Session): void {
    const player = session.player;

    // Input that arrives before the player has spawned has nothing to move
    if (!player || !player.spawned) return;

    // The client reports its eye position, so drop back down to the feet
    player.position = new Vector3f(
      packet.position.x,
      packet.position.y - EYE_HEIGHT,
      packet.position.z
    );

    player.rotation = {
      pitch: packet.rotation.x,
      yaw: packet.rotation.y,
      headYaw: packet.headYaw
    };

    player.inputTick = packet.inputTick;
  }
}

export { PlayerInputListener };
