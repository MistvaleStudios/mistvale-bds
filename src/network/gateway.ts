import { deflateRawSync, inflateRawSync } from "node:zlib";

import {
  CompressionMethod,
  DisconnectReason,
  Framer,
  getPacketId,
  MINECRAFT_VERSION,
  Packet,
  Packets,
  PROTOCOL_VERSION
} from "@serenityjs/protocol";
import { Frame, Priority, Reliability, Server } from "@serenityjs/raknet";

import { Logger } from "../core/logger";

import { Dispatcher } from "./dispatcher";
import { Session } from "./session";

import type { DataPacket } from "@serenityjs/protocol";
import type { Connection } from "@serenityjs/raknet";
import type { MistvaleServer } from "../server";

// The leading byte every Minecraft batch carries
const BATCH_HEADER = 0xfe;

// Batches smaller than this are sent uncompressed
const COMPRESSION_THRESHOLD = 256;

// Connections exceeding this many packets in one batch are dropped
const MAX_PACKETS_PER_BATCH = 64;

class Gateway {
  // The server instance this gateway feeds
  public readonly server: MistvaleServer;

  // The RakNet server handling the underlying UDP transport
  public readonly raknet: Server;

  // The dispatcher packets are routed through once decoded
  public readonly dispatcher: Dispatcher;

  // The live sessions, keyed by their RakNet connection
  public readonly sessions = new Map<Connection, Session>();

  // The logger used for transport level reporting
  public readonly logger = new Logger("Network", "§9");

  public constructor(server: MistvaleServer) {
    this.server = server;
    this.dispatcher = new Dispatcher(server);

    // Stand up the RakNet server using the operator's configured bind details
    this.raknet = new Server({
      address: server.config.host,
      port: server.config.port,
      protocol: PROTOCOL_VERSION,
      version: MINECRAFT_VERSION,
      message: server.config.motd,
      maxConnections: server.config.maxPlayers
    });

    this.raknet.on("connect", (connection) => this.onConnect(connection));
    this.raknet.on("disconnect", (connection) => this.onDisconnect(connection));
    this.raknet.on("encapsulated", (connection, ...buffers) =>
      this.onEncapsulated(connection, ...buffers)
    );

    // The bind is asynchronous, so only announce once it actually succeeds
    this.raknet.socket.on("listening", () => {
      this.logger.info(
        `Listening on §u${this.server.config.host}§8:§u${this.server.config.port}§r for Minecraft §u${MINECRAFT_VERSION}§r clients.`
      );

      this.server.onGatewayReady();
    });

    // Without this the socket emits an unhandled error and kills the process
    this.raknet.socket.on("error", (error) => this.onSocketError(error));
  }

  // Binds the socket and begins accepting connections
  public start(): void {
    this.raknet.start();
  }

  // Stops accepting connections and closes the socket
  public stop(): void {
    this.raknet.stop();
  }

  // Returns the session bound to the given connection, if one exists
  public getSession(connection: Connection): Session | null {
    return this.sessions.get(connection) ?? null;
  }

  // Reports a socket level failure, translating the common ones into advice
  private onSocketError(error: NodeJS.ErrnoException): void {
    const { host, port } = this.server.config;

    // A busy port is nearly always another server that is still running
    if (error.code === "EADDRINUSE") {
      this.logger.error(
        `Port §u${port}§r is already in use. Another server is still bound to it; stop it, or set a different §uport§r in the config.`
      );
    } else if (error.code === "EACCES") {
      this.logger.error(
        `Not permitted to bind §u${host}§8:§u${port}§r. Try a port above 1024, or run with the rights to bind this one.`
      );
    } else {
      this.logger.error(`Socket error on §u${host}§8:§u${port}§r:`, error);
    }

    // The transport is unusable, so hand the failure up to the server
    this.server.onGatewayFailure(error);
  }

  // Opens a session when a new RakNet connection is established
  private onConnect(connection: Connection): void {
    // A duplicate connection means something is wrong, so drop it
    if (this.sessions.has(connection)) return connection.disconnect();

    this.sessions.set(connection, new Session(this, connection));
    this.logger.debug(`Connection opened from §u${connection.rinfo.address}§r.`);
  }

  // Tears the session down when a RakNet connection goes away
  private onDisconnect(connection: Connection): void {
    const session = this.sessions.get(connection);
    if (!session) return;

    // Let the server clean up any player state bound to this session
    this.server.onSessionClosed(session);
    this.sessions.delete(connection);

    this.logger.debug(`Connection closed from §u${connection.rinfo.address}§r.`);
  }

  // Decodes an inbound batch and routes each packet it carries
  private onEncapsulated(connection: Connection, ...buffers: Array<Buffer>): void {
    const session = this.sessions.get(connection);
    if (!session) return;

    for (const buffer of buffers) {
      // Anything without the batch header is not a Minecraft payload
      if (buffer[0] !== BATCH_HEADER) {
        this.logger.debug(`Dropped a malformed batch from §u${session.address}§r.`);

        continue;
      }

      // Decrypt and decompress the batch back into its framed form
      const framed = this.unwrap(session, buffer.subarray(1));
      if (!framed) {
        session.disconnect("Malformed packet batch.", DisconnectReason.BadPacket);

        return;
      }

      // A single batch may carry many packets, so split them apart
      const frames = Framer.unframe(framed);

      // An oversized batch is either a bug or an attempt to overload us
      if (frames.length > MAX_PACKETS_PER_BATCH) {
        this.logger.warn(
          `Session §u${session.address}§r sent §u${frames.length}§r packets in one batch, disconnecting.`
        );
        session.disconnect("Too many packets in one batch.", DisconnectReason.BadPacket);

        return;
      }

      for (const frame of frames) this.route(session, frame);
    }
  }

  // Decodes a single framed packet and hands it to the dispatcher
  private route(session: Session, frame: Buffer): void {
    const id = getPacketId(frame) as Packet;

    // Packets we have no deserializer for cannot be acted on
    const serializer = Packets[id];
    if (!serializer) {
      this.logger.debug(`No deserializer for packet §u${Packet[id] ?? id}§r.`);

      return;
    }

    // Deserialization is the most likely place for a malformed client to fail
    try {
      const packet = new serializer(frame).deserialize() as DataPacket;

      this.dispatcher.dispatch(id, packet, session);
    } catch (error) {
      this.logger.error(
        `Failed to deserialize packet §u${Packet[id] ?? id}§r from §u${session.address}§r:`,
        error
      );
    }
  }

  // Serializes, batches, compresses and delivers packets to a session
  public send(
    session: Session,
    immediate: boolean,
    ...packets: Array<DataPacket>
  ): void {
    // A closed session has nowhere to deliver to
    if (!this.sessions.has(session.connection)) return;

    // Serialize each packet, skipping any that fail rather than dropping all
    const payloads: Array<Buffer> = [];
    for (const packet of packets) {
      try {
        payloads.push(packet.serialize());
      } catch (error) {
        this.logger.error(
          `Failed to serialize packet §u${Packet[packet.getId() as Packet] ?? packet.getId()}§r:`,
          error
        );
      }
    }

    if (payloads.length === 0) return;

    // Combine the packets into a single framed batch
    const framed = Framer.frame(...payloads);
    const wrapped = this.wrap(session, framed);

    // Prefix the batch header the client expects
    const payload = Buffer.allocUnsafe(1 + wrapped.byteLength);
    payload[0] = BATCH_HEADER;
    wrapped.copy(payload, 1);

    // Hand the batch to RakNet as a reliable, ordered frame
    const frame = new Frame();
    frame.reliability = Reliability.ReliableOrdered;
    frame.orderChannel = 0;
    frame.payload = payload;

    session.connection.sendFrame(
      frame,
      immediate ? Priority.Immediate : Priority.Normal
    );
  }

  // Applies compression and encryption to an outbound batch
  private wrap(session: Session, framed: Buffer): Buffer {
    // Before network settings are negotiated the batch is sent bare
    if (!session.compression) return framed;

    // Small batches skip compression, since the header would cost more
    if (framed.byteLength <= COMPRESSION_THRESHOLD) {
      const payload = Buffer.allocUnsafe(1 + framed.byteLength);
      payload[0] = CompressionMethod.None;
      framed.copy(payload, 1);

      return payload;
    }

    // Larger batches are deflated and tagged with the method used
    const deflated = deflateRawSync(framed);
    const payload = Buffer.allocUnsafe(1 + deflated.byteLength);
    payload[0] = CompressionMethod.Zlib;
    deflated.copy(payload, 1);

    return payload;
  }

  // Reverses compression and encryption on an inbound batch
  private unwrap(session: Session, buffer: Buffer): Buffer | null {
    // Encryption is not implemented yet, so the payload passes through
    let payload = buffer;

    // The leading byte names the compression method, when one is present
    const marker = payload[0] as number;
    const method: CompressionMethod =
      CompressionMethod[marker] === undefined
        ? CompressionMethod.NotPresent
        : marker;

    if (method !== CompressionMethod.NotPresent) payload = payload.subarray(1);

    // Only zlib needs actual work, the other methods are already plain
    if (method !== CompressionMethod.Zlib) return payload;

    // A malformed deflate stream must not take the server down
    try {
      return inflateRawSync(payload);
    } catch {
      this.logger.debug(`Failed to inflate a batch from §u${session.address}§r.`);

      return null;
    }
  }
}

export { Gateway, COMPRESSION_THRESHOLD };
