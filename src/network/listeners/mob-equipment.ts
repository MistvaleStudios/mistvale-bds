import { Packet } from "@serenityjs/protocol";

import { PacketListener } from "../listener";

import type { MobEquipmentPacket } from "@serenityjs/protocol";
import type { Session } from "../session";

class MobEquipmentListener extends PacketListener {
  public static override readonly packet = Packet.MobEquipment;

  public handle(packet: MobEquipmentPacket, session: Session): void {
    const player = session.player;
    if (!player || !player.spawned) return;

    // A client may only change its own held item
    if (packet.runtimeEntityId !== player.runtimeId) return;

    // The client picks its own hotbar slot, so this only records the change
    player.inventory.setSelectedSlot(packet.selectedSlot);

    // Other clients need telling so the held item renders in the right hand
    player.realm.broadcastExcept(
      player,
      player.inventory.createEquipmentPacket()
    );
  }
}

export { MobEquipmentListener };
