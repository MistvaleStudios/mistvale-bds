import { Packet } from "@serenityjs/protocol";

import { PacketListener } from "../listener";

import type { ContainerClosePacket } from "@serenityjs/protocol";
import type { Session } from "../session";

class ContainerCloseListener extends PacketListener {
  public static override readonly packet = Packet.ContainerClose;

  public handle(packet: ContainerClosePacket, session: Session): void {
    const player = session.player;
    if (!player) return;

    // Anything staged on the cursor or in the creative slot is dropped, so a
    // reopened inventory does not start holding a stale stack
    player.cursor = null;
    player.creativeOutput = null;

    // The client waits for the server to acknowledge the close, otherwise
    // the screen stays open and no further containers can be opened
    player.inventory.close(packet.serverInitiated);
  }
}

export { ContainerCloseListener };
