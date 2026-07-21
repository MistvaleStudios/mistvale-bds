import { Packet } from "@serenityjs/protocol";

import { PacketListener } from "../listener";
import { SessionStage } from "../session";

import type { DisconnectPacket } from "@serenityjs/protocol";
import type { Session } from "../session";

class DisconnectListener extends PacketListener {
  public static override readonly packet = Packet.Disconnect;

  public handle(_packet: DisconnectPacket, session: Session): void {
    // The client is leaving of its own accord, so just tear the session down
    session.stage = SessionStage.Closed;

    this.server.onSessionClosed(session);
  }
}

export { DisconnectListener };
