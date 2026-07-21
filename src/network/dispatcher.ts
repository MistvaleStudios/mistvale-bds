import { Packet } from "@serenityjs/protocol";

import { Logger } from "../core/logger";

import type { DataPacket } from "@serenityjs/protocol";
import type { MistvaleServer } from "../server";
import type { PacketListener, PacketListenerClass } from "./listener";
import type { Session } from "./session";

class Dispatcher {
  // The server instance every listener is constructed against
  public readonly server: MistvaleServer;

  // The registered listeners, grouped by the packet id they respond to
  private readonly listeners = new Map<Packet, Array<PacketListener>>();

  // The logger used to report routing problems
  private readonly logger = new Logger("Dispatch", "§9");

  public constructor(server: MistvaleServer) {
    this.server = server;
  }

  // Registers listener classes so their packets are routed to them
  public register(...classes: Array<PacketListenerClass>): void {
    for (const listener of classes) {
      // Group listeners by packet so several can observe the same id
      const existing = this.listeners.get(listener.packet) ?? [];
      existing.push(new listener(this.server));

      this.listeners.set(listener.packet, existing);
    }
  }

  // Whether any listener is registered for the given packet id
  public handles(id: Packet): boolean {
    return this.listeners.has(id);
  }

  // Routes a decoded packet to every listener registered for its id
  public dispatch(id: Packet, packet: DataPacket, session: Session): void {
    const listeners = this.listeners.get(id);

    // Unhandled packets are expected during early development, so only log
    if (!listeners) {
      this.logger.debug(`No listener for §u${Packet[id] ?? id}§r.`);

      return;
    }

    for (const listener of listeners) {
      // One misbehaving listener must not stop the others from running
      try {
        listener.handle(packet, session);
      } catch (error) {
        this.logger.error(
          `Listener §u${listener.constructor.name}§r failed on §u${Packet[id] ?? id}§r:`,
          error
        );
      }
    }
  }
}

export { Dispatcher };
