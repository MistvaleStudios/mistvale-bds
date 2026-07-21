import {
  AbilityIndex,
  AbilityLayer,
  AbilityLayerType,
  AbilitySet,
  CommandPermissionLevel,
  CreativeContentPacket,
  Gamemode,
  MovePlayerPacket,
  MoveMode,
  PermissionLevel,
  PlayerListAction,
  PlayerListPacket,
  PlayerListRecord,
  SetPlayerGameTypePacket,
  TeleportCause,
  UpdateAbilitiesPacket,
  Vector3f
} from "@serenityjs/protocol";

import { Registries } from "../registry/registries";

import { ChunkView } from "./chunk-view";

import type { DataPacket } from "@serenityjs/protocol";
import type { Realm } from "../level/realm";
import type { Session } from "../network/session";
import type { PlayerIdentity } from "./identity";

// The pitch, yaw and head yaw a player is facing
interface Rotation {
  pitch: number;
  yaw: number;
  headYaw: number;
}

// How far above a player's feet their eyes sit
const EYE_HEIGHT = 1.62;

class Player {
  // The session this player communicates over
  public readonly session: Session;

  // Everything the login tokens told us about this client
  public readonly identity: PlayerIdentity;

  // The id other entities reference this player by
  public readonly runtimeId: bigint;

  // The id that persists across sessions within a level
  public readonly uniqueId: bigint;

  // The chunk streaming state for this player
  public readonly view: ChunkView;

  // The realm this player currently occupies
  public realm: Realm;

  // The player's feet position within their realm
  public position: Vector3f;

  // The direction the player is facing
  public rotation: Rotation = { pitch: 0, yaw: 0, headYaw: 0 };

  // The gamemode currently applied to this player
  public gamemode: Gamemode;

  // Whether the player has operator privileges
  public operator = false;

  // Whether the player is standing on solid ground
  public onGround = true;

  // The most recent input tick reported by the client
  public inputTick = 0n;

  // Whether the client has finished loading and entered the world
  public spawned = false;

  public constructor(
    session: Session,
    identity: PlayerIdentity,
    realm: Realm,
    runtimeId: bigint,
    uniqueId: bigint
  ) {
    this.session = session;
    this.identity = identity;
    this.realm = realm;
    this.runtimeId = runtimeId;
    this.uniqueId = uniqueId;
    this.position = new Vector3f(realm.spawn.x, realm.spawn.y, realm.spawn.z);
    this.gamemode = realm.level.defaultGamemode;

    // The client never renders further than it asked for or the realm allows
    this.view = new ChunkView(
      this,
      Math.min(realm.properties.viewDistance, identity.device.maxViewDistance)
    );
  }

  // The display name shown to other players
  public get username(): string {
    return this.identity.username;
  }

  // The level the player's realm belongs to
  public get level() {
    return this.realm.level;
  }

  // The position the player's camera sits at
  public get eyePosition(): Vector3f {
    return new Vector3f(
      this.position.x,
      this.position.y + EYE_HEIGHT,
      this.position.z
    );
  }

  // Queues packets to be delivered to this player
  public send(...packets: Array<DataPacket>): void {
    this.session.send(...packets);
  }

  // Delivers packets to this player ahead of anything already queued
  public sendImmediate(...packets: Array<DataPacket>): void {
    this.session.sendImmediate(...packets);
  }

  // Places the player into the world once the client reports it is ready
  public spawn(): void {
    // Spawning twice would duplicate the player in every list
    if (this.spawned) return;
    this.spawned = true;

    this.realm.addPlayer(this);

    // Tell the client what it is allowed to do and how it should move
    this.sendImmediate(
      this.createPlayerListPacket(PlayerListAction.Add),
      this.createAbilitiesPacket(),
      this.createGamemodePacket()
    );

    // Hand over the registry payloads the client needs to render the world
    this.sendImmediate(
      Registries.getBiomeDefinitions(),
      Player.createCreativeContentPacket()
    );

    // Push the terrain surrounding the spawn point before releasing the player
    this.view.sendAll();

    // A teleport settles the client at the exact position we expect
    this.teleport(this.position);
  }

  // Removes the player from the world
  public despawn(): void {
    if (!this.spawned) return;
    this.spawned = false;

    this.realm.removePlayer(this);
    this.view.clear();
  }

  // Moves the player to a position, correcting the client's prediction
  public teleport(position: Vector3f): void {
    this.position = position;

    const packet = new MovePlayerPacket();
    packet.runtimeId = this.runtimeId;
    packet.position = new Vector3f(
      position.x,
      position.y + EYE_HEIGHT,
      position.z
    );
    packet.pitch = this.rotation.pitch;
    packet.yaw = this.rotation.yaw;
    packet.headYaw = this.rotation.headYaw;
    packet.mode = MoveMode.Teleport;
    packet.onGround = this.onGround;
    packet.riddenRuntimeId = 0n;
    packet.cause = new TeleportCause(4, 0);
    packet.inputTick = this.inputTick;

    this.sendImmediate(packet);
  }

  // Advances this player's per-tick work
  public tick(): void {
    if (!this.spawned) return;

    this.view.tick();
  }

  // Applies a new gamemode and informs the client
  public setGamemode(gamemode: Gamemode): void {
    this.gamemode = gamemode;

    this.send(this.createGamemodePacket(), this.createAbilitiesPacket());
  }

  // Builds the player list entry describing this player
  public createPlayerListPacket(action: PlayerListAction): PlayerListPacket {
    const packet = new PlayerListPacket();
    packet.action = action;

    // A removal only needs the uuid, so the remaining fields stay null
    packet.records = [
      new PlayerListRecord(
        this.identity.uuid,
        action === PlayerListAction.Add ? this.uniqueId : null,
        action === PlayerListAction.Add ? this.username : null,
        action === PlayerListAction.Add ? this.identity.xuid : null,
        action === PlayerListAction.Add ? String() : null,
        action === PlayerListAction.Add ? this.identity.device.os : null,
        action === PlayerListAction.Add ? this.identity.skin : null,
        action === PlayerListAction.Add ? false : null,
        action === PlayerListAction.Add ? false : null,
        action === PlayerListAction.Add ? false : null,
        null
      )
    ];

    return packet;
  }

  // Builds the ability layer describing what this player may do
  public createAbilitiesPacket(): UpdateAbilitiesPacket {
    // Creative and spectator players fly, everyone else walks
    const creative =
      this.gamemode === Gamemode.Creative ||
      this.gamemode === Gamemode.CreativeSpectator;
    const spectator = this.gamemode === Gamemode.Spectator;

    const abilities: Array<AbilitySet> = [
      new AbilitySet(AbilityIndex.Build, !spectator),
      new AbilitySet(AbilityIndex.Mine, !spectator),
      new AbilitySet(AbilityIndex.DoorsAndSwitches, !spectator),
      new AbilitySet(AbilityIndex.OpenContainers, !spectator),
      new AbilitySet(AbilityIndex.AttackPlayers, !spectator),
      new AbilitySet(AbilityIndex.AttackMobs, !spectator),
      new AbilitySet(AbilityIndex.OperatorCommands, this.operator),
      new AbilitySet(AbilityIndex.Teleport, this.operator),
      new AbilitySet(AbilityIndex.Invulnerable, creative || spectator),
      new AbilitySet(AbilityIndex.Flying, spectator),
      new AbilitySet(AbilityIndex.MayFly, creative || spectator),
      new AbilitySet(AbilityIndex.InstantBuild, creative),
      new AbilitySet(AbilityIndex.Lightning, false),
      new AbilitySet(AbilityIndex.FlySpeed, true),
      new AbilitySet(AbilityIndex.WalkSpeed, true),
      new AbilitySet(AbilityIndex.Muted, false),
      new AbilitySet(AbilityIndex.WorldBuilder, false),
      new AbilitySet(AbilityIndex.NoClip, spectator),
      new AbilitySet(AbilityIndex.PrivilegedBuilder, false),
      new AbilitySet(AbilityIndex.VerticalFlySpeed, true)
    ];

    const packet = new UpdateAbilitiesPacket();
    packet.entityUniqueId = this.uniqueId;
    packet.permissionLevel = this.operator
      ? PermissionLevel.Operator
      : PermissionLevel.Member;
    packet.commandPermissionLevel = this.operator
      ? CommandPermissionLevel.GameDirectors
      : CommandPermissionLevel.Any;
    packet.abilities = [
      new AbilityLayer(AbilityLayerType.Base, abilities, 0.05, 1, 0.1)
    ];

    return packet;
  }

  // Builds the packet informing the client of its current gamemode
  public createGamemodePacket(): SetPlayerGameTypePacket {
    const packet = new SetPlayerGameTypePacket();
    packet.gamemode = this.gamemode;

    return packet;
  }

  // Builds an empty creative menu, which the client requires to be present
  public static createCreativeContentPacket(): CreativeContentPacket {
    const packet = new CreativeContentPacket();
    packet.groups = [];
    packet.items = [];

    return packet;
  }
}

export { Player, Rotation, EYE_HEIGHT };
