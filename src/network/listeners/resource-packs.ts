import {
  AvailableActorIdentifiersPacket,
  BlockPosition,
  DisconnectReason,
  GameRuleType,
  MINECRAFT_VERSION,
  Packet,
  PermissionLevel,
  PlayStatus,
  PlayStatusPacket,
  ResourcePackResponse,
  ResourcePackStackPacket,
  StartGamePacket,
  Vector3f,
  VoxelShapesPacket
} from "@serenityjs/protocol";
import { CompoundTag, ListTag } from "@serenityjs/nbt";

import { EYE_HEIGHT } from "../../entity/player";
import { Registries } from "../../registry/registries";
import { PacketListener } from "../listener";
import { SessionStage } from "../session";

import type { ResourcePackClientResponsePacket } from "@serenityjs/protocol";
import type { Player } from "../../entity/player";
import type { Session } from "../session";

// The identifier the client shows as the world's engine
const ENGINE = "Mistvale";

class ResourcePackListener extends PacketListener {
  public static override readonly packet = Packet.ResourcePackClientResponse;

  public handle(
    packet: ResourcePackClientResponsePacket,
    session: Session
  ): void {
    // Every branch below needs the player the login listener created
    const player = session.player;
    if (!player) {
      return session.disconnect(
        "Resource pack response arrived before login completed.",
        DisconnectReason.LoginPacketNoRequest
      );
    }

    switch (packet.response) {
      case ResourcePackResponse.Refused: {
        // No packs are required yet, so a refusal should never arrive
        return session.disconnect(
          "You must accept the server's resource packs.",
          DisconnectReason.Kicked
        );
      }

      case ResourcePackResponse.HaveAllPacks: {
        // The client holds everything, so hand it the empty pack stack
        const stack = new ResourcePackStackPacket();
        stack.mustAccept = false;
        stack.gameVersion = MINECRAFT_VERSION;
        stack.experiments = [];
        stack.experimentsPreviouslyToggled = false;
        stack.hasEditorPacks = false;
        stack.texturePacks = [];

        return session.sendImmediate(stack);
      }

      case ResourcePackResponse.Completed: {
        return this.startGame(player, session);
      }

      default: {
        // Pack downloading is not implemented, so anything else is unexpected
        this.server.logger.debug(
          `Unhandled resource pack response §u${ResourcePackResponse[packet.response]}§r from §u${session.address}§r.`
        );
      }
    }
  }

  // Sends the payload that puts the client into the world
  private startGame(player: Player, session: Session): void {
    const { level, realm } = player;

    const start = new StartGamePacket();

    // Identity and placement of the player being spawned
    start.entityId = player.uniqueId;
    start.runtimeEntityId = player.runtimeId;
    start.playerGamemode = player.gamemode;
    start.playerPosition = new Vector3f(
      player.position.x,
      player.position.y + EYE_HEIGHT,
      player.position.z
    );
    start.pitch = player.rotation.pitch;
    start.yaw = player.rotation.yaw;

    // World shape and generation settings
    start.seed = BigInt(level.seed);
    start.biomeType = 0;
    start.biomeName = "plains";
    start.dimension = realm.type;
    start.generator = 1;
    start.worldGamemode = level.defaultGamemode;
    start.hardcore = false;
    start.difficulty = level.difficulty;
    start.spawnPosition = new BlockPosition(
      Math.floor(realm.spawn.x),
      Math.floor(realm.spawn.y),
      Math.floor(realm.spawn.z)
    );

    // Editor and education fields, none of which this server uses
    start.achievementsDisabled = true;
    start.editorWorldType = 0;
    start.createdInEdior = false;
    start.exportedFromEdior = false;
    start.eduOffer = 0;
    start.eduFeatures = false;
    start.eduProductUuid = String();
    start.eduResourceUriButtonName = String();
    start.eduResourceUriLink = String();
    start.serverEditorConnectionPolicy = 0;
    start.allowAnonymousBlockDropsInEditorWorld = false;

    // Ambient world state
    start.dayCycleStopTime = level.dayTime;
    start.rainLevel = 0;
    start.lightningLevel = 0;

    // Multiplayer and broadcast settings
    start.confirmedPlatformLockedContent = false;
    start.multiplayerGame = true;
    start.broadcastToLan = true;
    start.xblBroadcastMode = 6;
    start.platformBroadcastMode = 6;
    start.commandsEnabled = true;
    start.texturePacksRequired = false;
    start.multiplayerCorrelationId = String();

    // Game rules are mapped straight from the level's rule table
    start.gamerules = Object.entries(level.gamerules).map(([name, value]) => ({
      name,
      type: typeof value === "boolean" ? GameRuleType.Bool : GameRuleType.Int,
      value,
      editable: true
    }));

    // Experiments and world template settings, all left at their defaults
    start.experiments = [];
    start.experimentsPreviouslyToggled = false;
    start.bonusChest = false;
    start.mapEnabled = false;
    start.hasLockedBehaviorPack = false;
    start.hasLockedResourcePack = false;
    start.isFromLockedWorldTemplate = false;
    start.useMsaGamertagsOnly = false;
    start.isFromWorldTemplate = false;
    start.isWorldTemplateOptionLocked = false;
    start.premiumWorldTemplateId = String();
    start.worldTemplateId = "00000000-0000-0000-0000-000000000000";
    start.isTrial = false;

    // Player permissions and simulation ranges
    start.permissionLevel = player.operator
      ? PermissionLevel.Operator
      : PermissionLevel.Member;
    start.serverChunkTickRange = realm.properties.viewDistance;
    start.chatRestrictionLevel = 0;
    start.disablePlayerInteractions = false;

    // Cosmetic and gameplay toggles
    start.onlySpawnV1Villagers = false;
    start.personaDisabled = false;
    start.customSkinsDisabled = false;
    start.emoteChatMuted = false;
    start.isNewNether = false;
    start.experimentalGameplayOverride = false;
    start.limitedWorldWidth = 16;
    start.limitedWorldLength = 16;

    // Level naming and versioning
    start.gameVersion = MINECRAFT_VERSION;
    start.levelIdentfier = ENGINE;
    start.levelName = level.identifier;
    start.engine = ENGINE;

    // Server authority settings, which keep the client in a predictive mode
    start.rewindHistorySize = 0;
    start.serverAuthoritativeBlockBreaking = true;
    start.serverAuthoritativeInventory = true;
    start.serverControlledSounds = true;
    start.clientSideGeneration = false;
    start.isChatLogging = false;

    // Block states are addressed by their hash rather than a runtime index
    start.blockNetworkIdsAreHashes = true;
    start.blockPaletteChecksum = 0n;
    start.blockTypeDefinitions = [];

    // Level bookkeeping the client mirrors
    start.currentTick = level.currentTick;
    start.enchantmentSeed = level.seed;
    start.properties = new CompoundTag();

    // Join telemetry, which carries no meaningful data for this server
    start.containsServerJoinInfo = {
      gatheringJoinInfo: null,
      presenceInfo: null,
      storeEntryPointInfo: null
    };
    start.serverTelemetryData = {
      serverId: ENGINE,
      scenarioId: `mistvale.${level.identifier.toLowerCase().replace(/\s+/g, "-")}`,
      worldId: level.identifier,
      ownerId: player.username
    };

    // The client requires a voxel shape registry, even an empty one
    const voxels = new VoxelShapesPacket();
    voxels.shapes = [];
    voxels.names = [];

    // No custom entities are registered, so the identifier list is empty
    const actors = new AvailableActorIdentifiersPacket();
    actors.data = new CompoundTag();
    actors.data.add(new ListTag<CompoundTag>([], "idlist"));

    // Tells the client it may begin loading the world
    const status = new PlayStatusPacket();
    status.status = PlayStatus.PlayerSpawn;

    session.stage = SessionStage.Spawning;
    session.sendImmediate(
      voxels,
      start,
      status,
      actors,
      Registries.getItemRegistry()
    );
  }
}

export { ResourcePackListener };
