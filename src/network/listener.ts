import type { DataPacket, Packet } from "@serenityjs/protocol";
import type { MistvaleServer } from "../server";
import type { Session } from "./session";

abstract class PacketListener {
  // The packet id this listener is invoked for
  public static readonly packet: Packet;

  // The server instance the listener acts on
  public readonly server: MistvaleServer;

  public constructor(server: MistvaleServer) {
    this.server = server;
  }

  // Handles a single inbound packet for the given session
  public abstract handle(packet: DataPacket, session: Session): void;
}

// The shape a listener class must have to be registered with the dispatcher
type PacketListenerClass = (new (server: MistvaleServer) => PacketListener) & {
  readonly packet: Packet;
};

export { PacketListener, PacketListenerClass };
