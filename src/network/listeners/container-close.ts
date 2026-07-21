import { Packet } from "@serenityjs/protocol";

import { PacketListener } from "../listener";

import type { ContainerClosePacket } from "@serenityjs/protocol";
import type { Session } from "../session";

class ContainerCloseListener extends PacketListener {
  public static override readonly packet = Packet.ContainerClose;

  public handle(packet: ContainerClosePacket, session: Session): void {
    const player = session.player;
    if (!player) return;

    // Anything the player was holding on the cursor goes back to the world
    player.cursor = null;

    // The client waits for the server to acknowledge the close, otherwise
    // the screen stays open and no further containers can be opened
    player.inventory.close(packet.serverInitiated);
  }
}

export { ContainerCloseListener };
