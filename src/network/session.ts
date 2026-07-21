import { DisconnectMessage, DisconnectPacket, DisconnectReason } from "@serenityjs/protocol";

import type { DataPacket } from "@serenityjs/protocol";
import type { Connection } from "@serenityjs/raknet";
import type { Player } from "../entity/player";
import type { Gateway } from "./gateway";

// The stages a session moves through during the join handshake
enum SessionStage {
  // The connection exists but has not negotiated network settings yet
  Handshake = 0,

  // Network settings are agreed and the client is authenticating
  Authenticating = 1,

  // The client is downloading and acknowledging resource packs
  Resources = 2,

  // The start game payload has been sent and the client is loading terrain
  Spawning = 3,

  // The client has finished loading and is playing
  Playing = 4,

  // The session has been torn down
  Closed = 5
}

class Session {
  // The gateway that owns this session
  public readonly gateway: Gateway;

  // The underlying RakNet connection
  public readonly connection: Connection;

  // Whether outbound batches for this session are compressed
  public compression = false;

  // Whether outbound batches for this session are encrypted
  public encryption = false;

  // How far through the join handshake this session has progressed
  public stage: SessionStage = SessionStage.Handshake;

  // The player bound to this session, once authentication has completed
  public player: Player | null = null;

  public constructor(gateway: Gateway, connection: Connection) {
    this.gateway = gateway;
    this.connection = connection;
  }

  // A short label identifying the remote peer, used in logs
  public get address(): string {
    return `${this.connection.rinfo.address}:${this.connection.rinfo.port}`;
  }

  // Queues packets to be delivered on the next outbound flush
  public send(...packets: Array<DataPacket>): void {
    this.gateway.send(this, false, ...packets);
  }

  // Delivers packets ahead of anything already queued
  public sendImmediate(...packets: Array<DataPacket>): void {
    this.gateway.send(this, true, ...packets);
  }

  // Closes the session, showing the given reason on the client
  public disconnect(
    message: string,
    reason: DisconnectReason = DisconnectReason.Kicked
  ): void {
    // Tell the client why it is being dropped before cutting the connection
    const packet = new DisconnectPacket();
    packet.message = new DisconnectMessage(message, String());
    packet.reason = reason;
    packet.hideDisconnectScreen = false;

    this.sendImmediate(packet);
    this.stage = SessionStage.Closed;

    // Give the disconnect packet a chance to leave before the socket closes
    setImmediate(() => this.connection.disconnect());
  }
}

export { Session, SessionStage };
