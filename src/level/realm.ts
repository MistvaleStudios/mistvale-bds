import { ChunkCoords, DimensionType, Vector3f } from "@serenityjs/protocol";

import { BlockState } from "../registry/block-state";

import { Chunk } from "./chunk";

import type { DataPacket } from "@serenityjs/protocol";
import type { Player } from "../entity/player";
import type { Level } from "./level";
import type { TerrainGenerator } from "./generator";

// The settings a realm is constructed with
interface RealmProperties {
  // The name operators and commands use to address this realm
  identifier: string;

  // The dimension type the client renders this realm as
  type: DimensionType;

  // The generator that produces chunks for this realm
  generator: TerrainGenerator;

  // The position new players are placed at
  spawn: Vector3f;

  // The furthest chunk radius this realm will serve
  viewDistance: number;
}

class Realm {
  // The level this realm belongs to
  public readonly level: Level;

  // The settings this realm was constructed with
  public readonly properties: RealmProperties;

  // The chunks currently resident in memory, keyed by their packed coordinate
  public readonly chunks = new Map<bigint, Chunk>();

  // The players currently present in this realm
  public readonly players = new Set<Player>();

  public constructor(level: Level, properties: RealmProperties) {
    this.level = level;
    this.properties = properties;
  }

  // The name operators and commands use to address this realm
  public get identifier(): string {
    return this.properties.identifier;
  }

  // The dimension type the client renders this realm as
  public get type(): DimensionType {
    return this.properties.type;
  }

  // The position new players are placed at
  public get spawn(): Vector3f {
    return this.properties.spawn;
  }

  // Returns the chunk at the given chunk coordinates, generating it if needed
  public getChunk(x: number, z: number): Chunk {
    // Serve the chunk from memory when it is already resident
    const key = ChunkCoords.hash({ x, z });
    const resident = this.chunks.get(key);
    if (resident) return resident;

    // Otherwise generate it and keep it around for subsequent lookups
    const chunk = this.properties.generator.generate(x, z);
    this.chunks.set(key, chunk);

    return chunk;
  }

  // Whether the chunk at the given coordinates is already in memory
  public hasChunk(x: number, z: number): boolean {
    return this.chunks.has(ChunkCoords.hash({ x, z }));
  }

  // The block state at the given absolute world coordinates
  public getState(x: number, y: number, z: number, layer = 0): BlockState {
    return this.getChunk(x >> 4, z >> 4).getState(x & 0xf, y, z & 0xf, layer);
  }

  // Places a block state at the given absolute world coordinates
  public setState(
    x: number,
    y: number,
    z: number,
    state: BlockState,
    layer = 0
  ): void {
    this.getChunk(x >> 4, z >> 4).setState(x & 0xf, y, z & 0xf, state, layer);
  }

  // The highest solid block Y at the given absolute X and Z, or the floor
  public getSurface(x: number, z: number): number {
    const chunk = this.getChunk(x >> 4, z >> 4);

    // Walk down from the ceiling until a non-air block is found
    for (let y = chunk.ceiling - 1; y >= chunk.floor; y--) {
      const state = chunk.getState(x & 0xf, y, z & 0xf);
      if (!state.type.properties.air) return y;
    }

    return chunk.floor;
  }

  // Adds a player to this realm's occupant list
  public addPlayer(player: Player): void {
    this.players.add(player);
  }

  // Removes a player from this realm's occupant list
  public removePlayer(player: Player): void {
    this.players.delete(player);
  }

  // Sends packets to every player in this realm
  public broadcast(...packets: Array<DataPacket>): void {
    for (const player of this.players) player.send(...packets);
  }

  // Sends packets to every player in this realm except the one given
  public broadcastExcept(
    exclude: Player,
    ...packets: Array<DataPacket>
  ): void {
    for (const player of this.players) {
      if (player !== exclude) player.send(...packets);
    }
  }
}

export { Realm, RealmProperties };
