import {
  COMPATIBLE_PROTOCOL_VERSIONS,
  CompressionMethod,
  DisconnectReason,
  MINECRAFT_VERSION,
  NetworkSettingsPacket,
  Packet,
  PROTOCOL_VERSION
} from "@serenityjs/protocol";

import { COMPRESSION_THRESHOLD } from "../gateway";
import { PacketListener } from "../listener";
import { SessionStage } from "../session";

import type { RequestNetworkSettingsPacket } from "@serenityjs/protocol";
import type { Session } from "../session";

class NetworkSettingsListener extends PacketListener {
  public static override readonly packet = Packet.RequestNetworkSettings;

  public handle(packet: RequestNetworkSettingsPacket, session: Session): void {
    // Reject clients speaking a protocol version we cannot understand
    if (!COMPATIBLE_PROTOCOL_VERSIONS.has(packet.protocol)) {
      const outdated = packet.protocol < PROTOCOL_VERSION;

      return session.disconnect(
        outdated
          ? `Your client is out of date. This server runs Minecraft ${MINECRAFT_VERSION}.`
          : `This server is out of date. It runs Minecraft ${MINECRAFT_VERSION}.`,
        outdated
          ? DisconnectReason.OutdatedClient
          : DisconnectReason.OutdatedServer
      );
    }

    // Tell the client how batches will be compressed from here on
    const settings = new NetworkSettingsPacket();
    settings.compressionThreshold = COMPRESSION_THRESHOLD;
    settings.compressionMethod = CompressionMethod.Zlib;
    settings.clientThrottle = false;
    settings.clientThreshold = 0;
    settings.clientScalar = 0;

    // This packet itself is still sent uncompressed
    session.sendImmediate(settings);

    // Everything after this point is compressed in both directions
    session.compression = true;
    session.stage = SessionStage.Authenticating;
  }
}

export { NetworkSettingsListener };
