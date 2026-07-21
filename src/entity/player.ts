import {
  AbilityIndex,
  AbilityLayer,
  AbilityLayerType,
  AbilitySet,
  ActorDataId,
  ActorFlag,
  AddPlayerPacket,
  Attribute,
  AttributeName,
  Color,
  CommandPermissionLevel,
  Gamemode,
  MoveActorDeltaPacket,
  MoveDeltaFlags,
  MovePlayerPacket,
  MoveMode,
  NetworkItemStackDescriptor,
  PermissionLevel,
  PlayerListAction,
  PlayerListPacket,
  PlayerListRecord,
  PropertySyncData,
  RemoveEntityPacket,
  SetActorDataPacket,
  SetPlayerGameTypePacket,
  TeleportCause,
  UpdateAbilitiesPacket,
  UpdateAttributesPacket,
  Vector3f
} from "@serenityjs/protocol";

import { CreativeRegistry } from "../registry/creative";
import { Registries } from "../registry/registries";
import { Inventory } from "../item/inventory";

import { ActorMetadata } from "./metadata";
import { ChunkView } from "./chunk-view";

import type { ItemStack } from "../item/item-stack";

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

// How far above a player's feet their eyes sit. This doubles as the collision
// height, which other clients expect movement broadcasts to be offset by.
const EYE_HEIGHT = 1.62;

// The collision box a standing player occupies
const PLAYER_WIDTH = 0.6;
const PLAYER_HEIGHT = 1.8;

// The shorter collision box the client expects while a player is sneaking
const SNEAKING_HEIGHT = 1.5;

// The base movement speed the client applies when walking
const WALK_SPEED = 0.1;

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

  // The actor fields and flags other clients render this player from
  public readonly metadata = new ActorMetadata();

  // The items this player is carrying
  public readonly inventory: Inventory;

  // The stack held on the mouse while rearranging the inventory
  public cursor: ItemStack | null = null;

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

  // Whether the player is currently flying
  private flying = false;

  // Whether the sneak input is held, which is not the same as the crouch pose
  private sneakInput = false;

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

    this.inventory = new Inventory(this);

    // The client never renders further than it asked for or the realm allows
    this.view = new ChunkView(
      this,
      Math.min(realm.properties.viewDistance, identity.device.maxViewDistance)
    );

    // Without these the model renders wrong or falls through the world
    this.metadata
      .setFlag(ActorFlag.Breathing)
      .setFlag(ActorFlag.HasCollision)
      .setFlag(ActorFlag.HasGravity)
      .setFlag(ActorFlag.CanClimb)
      .setFloat(ActorDataId.BoundingBoxWidth, PLAYER_WIDTH)
      .setFloat(ActorDataId.BoundingBoxHeight, PLAYER_HEIGHT)
      .setString(ActorDataId.Name, identity.username);

    // Player nametags stay visible rather than only showing on look. The
    // client gates this on both a flag pair and a byte field, so set all three
    this.metadata
      .setFlag(ActorFlag.CanShowName)
      .setFlag(ActorFlag.AlwaysShowName)
      .setByte(ActorDataId.NametagAlwaysShow, 1);
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

    // Everyone already present must be listed and rendered for this client.
    // Collected before joining the realm so this player is not included.
    const present: Array<DataPacket> = [];
    for (const player of this.realm.players) {
      present.push(player.createPlayerListAddPacket());

      // Only players who have finished spawning have a position worth sending
      if (player.spawned) present.push(player.createAddPlayerPacket());
    }

    this.realm.addPlayer(this);

    // Tell the client who it is and what it is allowed to do
    this.sendImmediate(
      this.createPlayerListAddPacket(),
      this.createActorDataPacket(),
      this.createAttributesPacket(),
      this.createAbilitiesPacket(),
      this.createGamemodePacket()
    );

    // Hand over the registry payloads the client needs to render the world
    this.sendImmediate(
      Registries.getBiomeDefinitions(),
      CreativeRegistry.getContentPacket()
    );

    // Followed by whatever this player is already carrying
    this.sendImmediate(
      this.inventory.createContentPacket(),
      this.inventory.createEquipmentPacket()
    );

    // Then everyone already in the world
    if (present.length > 0) this.sendImmediate(...present);

    // And announce this player to everyone else
    this.realm.broadcastExcept(
      this,
      this.createPlayerListAddPacket(),
      this.createAddPlayerPacket()
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

    // Everyone still present must stop rendering this player
    this.realm.broadcast(this.createRemoveEntityPacket());
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

  // Builds the packet adding this player to another client's player list
  public createPlayerListAddPacket(): PlayerListPacket {
    const packet = new PlayerListPacket();
    packet.action = PlayerListAction.Add;

    // Every field of an add record is written unconditionally, so none of
    // them may be left null, including the locator bar colour
    packet.records = [
      new PlayerListRecord(
        this.identity.uuid,
        this.uniqueId,
        this.username,
        this.identity.xuid,
        String(),
        this.identity.device.os,
        this.identity.skin,
        false,
        false,
        false,
        new Color(0, 0, 0, 0)
      )
    ];

    return packet;
  }

  // Builds the packet removing this player from another client's player list
  public createPlayerListRemovePacket(): PlayerListPacket {
    const packet = new PlayerListPacket();
    packet.action = PlayerListAction.Remove;

    // A removal only writes the uuid, so the remaining fields are left unset
    packet.records = [new PlayerListRecord(this.identity.uuid)];

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

  // Builds the packet that makes this player visible to another client
  public createAddPlayerPacket(): AddPlayerPacket {
    const packet = new AddPlayerPacket();

    packet.uuid = this.identity.uuid;
    packet.username = this.username;
    packet.runtimeId = this.runtimeId;
    packet.uniqueEntityId = this.uniqueId;
    packet.platformChatId = String();

    // Other clients render the model from its feet, unlike the owning client
    packet.position = new Vector3f(
      this.position.x,
      this.position.y,
      this.position.z
    );
    packet.velocity = new Vector3f(0, 0, 0);
    packet.pitch = this.rotation.pitch;
    packet.yaw = this.rotation.yaw;
    packet.headYaw = this.rotation.headYaw;

    // Nothing is held yet, so an empty descriptor stands in
    packet.heldItem = new NetworkItemStackDescriptor(0);
    packet.gamemode = this.gamemode;
    packet.data = this.metadata.toDataItems();
    packet.properties = new PropertySyncData([], []);

    packet.permissionLevel = this.operator
      ? PermissionLevel.Operator
      : PermissionLevel.Member;
    packet.commandPermission = this.operator
      ? CommandPermissionLevel.GameDirectors
      : CommandPermissionLevel.Any;
    packet.abilities = this.createAbilitiesPacket().abilities;
    packet.links = [];
    packet.deviceId = this.identity.device.id;
    packet.deviceOS = this.identity.device.os;

    return packet;
  }

  // Builds the packet describing this player's attributes. Without these the
  // client falls back to its own defaults, which do not match the server's.
  public createAttributesPacket(): UpdateAttributesPacket {
    const packet = new UpdateAttributesPacket();
    packet.runtimeActorId = this.runtimeId;
    packet.inputTick = this.inputTick;

    // Movement speed drives how fast the client walks, so it must be sent
    packet.attributes = [
      new Attribute(
        0,
        3.402_823_466e38,
        WALK_SPEED,
        0,
        3.402_823_466e38,
        WALK_SPEED,
        AttributeName.Movement,
        []
      ),
      new Attribute(0, 20, 20, 0, 20, 20, AttributeName.Health, []),
      new Attribute(0, 20, 20, 0, 20, 20, AttributeName.PlayerHunger, []),
      new Attribute(0, 20, 5, 0, 20, 5, AttributeName.PlayerSaturation, []),
      new Attribute(0, 5, 0, 0, 5, 0, AttributeName.PlayerExhaustion, []),
      new Attribute(0, 24_791, 0, 0, 24_791, 0, AttributeName.PlayerLevel, []),
      new Attribute(0, 1, 0, 0, 1, 0, AttributeName.PlayerExperience, [])
    ];

    return packet;
  }

  // Applies a sneaking state, resizing the collision box to match the pose
  public setSneakInput(holding: boolean): void {
    this.sneakInput = holding;

    this.refreshPose();
  }

  // Records whether the player is flying, which suppresses the crouch pose
  public setFlying(flying: boolean): void {
    this.flying = flying;

    this.refreshPose();
  }

  // Whether other clients are currently rendering this player crouched
  public isSneaking(): boolean {
    return this.metadata.getFlag(ActorFlag.Sneaking);
  }

  // Whether the sneak input is held, regardless of what is being rendered
  public isHoldingSneak(): boolean {
    return this.sneakInput;
  }

  // Whether this player is currently flying
  public isFlying(): boolean {
    return this.flying;
  }

  // Applies the pose the current inputs imply, broadcasting only on a change
  private refreshPose(): void {
    // Holding sneak while flying means descend, not crouch, so the model
    // keeps standing. Without this the pose follows a flag that flickers
    // mid air, and other clients see the crouch animation repeat.
    const sneaking = this.sneakInput && !this.flying;

    // Input arrives every tick, so an unchanged pose must not be broadcast
    if (this.metadata.getFlag(ActorFlag.Sneaking) === sneaking) return;

    this.metadata.setFlag(ActorFlag.Sneaking, sneaking);

    // A sneaking player occupies a shorter box, which lets them fit gaps
    this.metadata.setFloat(
      ActorDataId.BoundingBoxHeight,
      sneaking ? SNEAKING_HEIGHT : PLAYER_HEIGHT
    );

    // Everyone, including this client, needs the new pose
    this.realm.broadcast(this.createActorDataPacket());
  }

  // Builds the packet describing this player's current metadata
  public createActorDataPacket(): SetActorDataPacket {
    const packet = new SetActorDataPacket();
    packet.runtimeEntityId = this.runtimeId;
    packet.data = this.metadata.toDataItems();
    packet.properties = new PropertySyncData([], []);
    packet.inputTick = this.inputTick;

    return packet;
  }

  // Builds the packet that stops other clients rendering this player
  public createRemoveEntityPacket(): RemoveEntityPacket {
    const packet = new RemoveEntityPacket();
    packet.uniqueEntityId = this.uniqueId;

    return packet;
  }

  // Builds the packet broadcasting this player's movement to other clients
  public createMovePacket(): MoveActorDeltaPacket {
    const packet = new MoveActorDeltaPacket();
    packet.runtimeId = this.runtimeId;

    // Every component is present, so the client applies the whole transform
    packet.flags = MoveDeltaFlags.All;
    if (this.onGround) packet.flags |= MoveDeltaFlags.OnGround;

    packet.x = this.position.x;

    // Other clients position the model from its collision height, not its
    // feet, so sending the raw position sinks the model into the ground
    packet.y = this.position.y + EYE_HEIGHT;
    packet.z = this.position.z;
    packet.pitch = this.rotation.pitch;
    packet.yaw = this.rotation.yaw;
    packet.headYaw = this.rotation.headYaw;

    return packet;
  }

}

export { Player, Rotation, EYE_HEIGHT };
