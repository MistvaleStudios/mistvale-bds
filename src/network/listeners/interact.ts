import { InteractAction, Packet } from "@serenityjs/protocol";

import { PacketListener } from "../listener";

import type { InteractPacket } from "@serenityjs/protocol";
import type { Session } from "../session";

class InteractListener extends PacketListener {
  public static override readonly packet = Packet.Interact;

  public handle(packet: InteractPacket, session: Session): void {
    const player = session.player;
    if (!player || !player.spawned) return;

    switch (packet.action) {
      case InteractAction.OpenInventory: {
        // The client asks the server to open the inventory rather than
        // opening it locally, since the server owns the container
        return player.inventory.open();
      }

      default: {
        this.server.logger.debug(
          `Unhandled interact action §u${InteractAction[packet.action] ?? packet.action}§r from §u${player.username}§r.`
        );
      }
    }
  }
}

export { InteractListener };
