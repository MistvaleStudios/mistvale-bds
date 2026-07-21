import {
  Authentication,
  AuthenticationType
} from "@bedrock-apis/carolina-authentication";
import {
  DisconnectReason,
  Packet,
  PlayStatus,
  PlayStatusPacket,
  ResourcePacksInfoPacket,
  SerializedSkin
} from "@serenityjs/protocol";

import {
  uuidFromUsername,
  uuidFromXuid,
  xuidFromUsername
} from "../../entity/identity";
import { PacketListener } from "../listener";
import { SessionStage } from "../session";

import type { ClientData, LoginPacket } from "@serenityjs/protocol";
import type { PlayerIdentity } from "../../entity/identity";
import type { Session } from "../session";

// The identity fields carried inside an offline login certificate chain
interface OfflineIdentity {
  cpk: string;
  displayName: string;
  identity: string;
}

class LoginListener extends PacketListener {
  public static override readonly packet = Packet.Login;

  public handle(packet: LoginPacket, session: Session): void {
    // Authentication reaches out to Xbox Live, so it cannot block the loop
    this.authenticate(packet, session).catch((error: Error) => {
      this.server.logger.debug(`Login failed for ${session.address}:`, error);

      session.disconnect(
        `Authentication failed.\n${error.message}`,
        DisconnectReason.NotAuthenticated
      );
    });
  }

  // Verifies the client's login tokens and admits it to the server
  private async authenticate(
    packet: LoginPacket,
    session: Session
  ): Promise<void> {
    const identity = await this.resolveIdentity(packet, session);

    // The identity resolver disconnects on failure and returns nothing
    if (!identity) return;

    // Only one session per account may be connected at a time
    const existing = this.server.getPlayerByXuid(identity.xuid);
    if (existing) {
      existing.session.disconnect(
        "You logged in from another location.",
        DisconnectReason.LoggedInOtherLocation
      );
    }

    // A full server turns away anyone who is not already an operator
    if (this.server.players.size >= this.server.config.maxPlayers) {
      return session.disconnect(
        "The server is full.",
        DisconnectReason.ServerFull
      );
    }

    // Bind the player to the session so later packets can find it
    this.server.createPlayer(session, identity);

    // Encryption is skipped, so the client is told login succeeded outright
    const status = new PlayStatusPacket();
    status.status = PlayStatus.LoginSuccess;

    // No resource packs are served yet, so the list is empty
    const resources = new ResourcePacksInfoPacket();
    resources.mustAccept = false;
    resources.hasAddons = false;
    resources.hasScripts = false;
    resources.forceDisableVibrantVisuals = false;
    resources.worldTemplateUuid = "00000000-0000-0000-0000-000000000000";
    resources.worldTemplateVersion = String();
    resources.packs = [];

    session.stage = SessionStage.Resources;
    session.sendImmediate(status, resources);

    this.server.logger.info(
      `§u${identity.username}§r joined the server from §8${session.address}§r.`
    );
  }

  // Turns the client's login tokens into a resolved player identity
  private async resolveIdentity(
    packet: LoginPacket,
    session: Session
  ): Promise<PlayerIdentity | null> {
    const { AuthenticationType: type, Token, Certificate } =
      Authentication.parse(packet.tokens.identity);

    // Self signed chains mean the client is not signed into Xbox Live
    const offline = type === AuthenticationType.OfflineSelfSigned;

    if (offline && this.server.config.onlineMode) {
      session.disconnect(
        "This server requires an Xbox Live account. Please sign in and try again.",
        DisconnectReason.NotAuthenticated
      );

      return null;
    }

    // Resolve the public key and account details from whichever chain we got
    let publicKey: string;
    let xuid: string;
    let username: string;
    let uuid: string;

    if (offline) {
      // The offline chain carries its identity in the certificate, not a token
      if (!Certificate) throw new Error("Offline login is missing a certificate.");

      const parsed = LoginListener.parseOfflineCertificate(Certificate);

      publicKey = parsed.cpk;
      username = parsed.displayName;
      uuid = parsed.identity || uuidFromUsername(username);
      xuid = xuidFromUsername(username);
    } else {
      // The online chain is verified against Xbox Live before it is trusted
      const verified = await Authentication.authenticate(Token);

      publicKey = verified.cpk;
      xuid = verified.xid;
      username = verified.xname;
      uuid = uuidFromXuid(xuid);
    }

    // The client data is signed with the same key, so verify it too
    const client = await Authentication.verify<ClientData>(
      packet.tokens.client,
      publicKey
    );

    return {
      username,
      xuid,
      uuid,
      skin: SerializedSkin.from(client),
      device: {
        id: client.DeviceId,
        model: client.DeviceModel,
        os: client.DeviceOS,
        maxViewDistance: client.MaxViewDistance,
        memoryTier: client.MemoryTier
      }
    };
  }

  // Extracts the player identity from an unsigned certificate chain
  private static parseOfflineCertificate(certificate: string): OfflineIdentity {
    const chain = JSON.parse(certificate) as { chain: Array<string> };

    for (const token of chain.chain) {
      // A well formed token has a header, a payload and a signature
      const parts = token.split(".");
      if (parts.length !== 3) continue;

      // The payload is the middle segment, encoded as base64url
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf8")
      ) as {
        extraData?: { displayName: string; identity: string };
        identityPublicKey?: string;
      };

      // Only one token in the chain carries the player's details
      if (!payload.extraData) continue;

      return {
        cpk: payload.identityPublicKey ?? String(),
        displayName: payload.extraData.displayName,
        identity: payload.extraData.identity
      };
    }

    throw new Error("Offline certificate did not contain any player identity.");
  }
}

export { LoginListener };
