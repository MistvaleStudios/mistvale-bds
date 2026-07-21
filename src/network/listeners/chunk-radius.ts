import { ChunkRadiusUpdatePacket, Packet } from "@serenityjs/protocol";

import { PacketListener } from "../listener";

import type { RequestChunkRadiusPacket } from "@serenityjs/protocol";
import type { Session } from "../session";

class ChunkRadiusListener extends PacketListener {
  public static override readonly packet = Packet.RequestChunkRadius;

  public handle(packet: RequestChunkRadiusPacket, session: Session): void {
    const player = session.player;
    if (!player) return;

    // Honour the client's request, but never exceed what the realm serves
    const radius = Math.max(
      1,
      Math.min(packet.radius, player.realm.properties.viewDistance)
    );

    player.view.viewDistance = radius;

    // Confirm the radius the client will actually be served
    const update = new ChunkRadiusUpdatePacket();
    update.radius = radius;

    session.sendImmediate(update);
  }
}

export { ChunkRadiusListener };
