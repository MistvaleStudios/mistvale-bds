import {
  BlockPosition,
  ChunkCoords,
  LevelChunkPacket,
  NetworkChunkPublisherUpdatePacket
} from "@serenityjs/protocol";

import { Chunk } from "../level/chunk";

import type { DataPacket } from "@serenityjs/protocol";
import type { Player } from "./player";

// The most chunks that will be pushed to a client in a single tick
const CHUNKS_PER_TICK = 8;

// How many ticks may pass before the publisher update is refreshed
const PUBLISHER_INTERVAL = 20;

class ChunkView {
  // The player whose view this tracks
  public readonly player: Player;

  // The keys of every chunk currently loaded on the client
  public readonly loaded = new Set<bigint>();

  // The chunk radius this player is served
  public viewDistance: number;

  // Cached spiral offsets, keyed by the radius they were generated for
  private static readonly offsets = new Map<number, Int16Array>();

  // Ticks elapsed since the publisher update was last sent
  private sincePublish = PUBLISHER_INTERVAL;

  public constructor(player: Player, viewDistance: number) {
    this.player = player;
    this.viewDistance = viewDistance;
  }

  // Streams any newly visible chunks and evicts any that fell out of range
  public tick(): void {
    this.evict();
    this.stream();

    // Refresh the client's chunk publisher on a fixed cadence
    if (++this.sincePublish >= PUBLISHER_INTERVAL) {
      this.player.send(this.createPublisherUpdate());
      this.sincePublish = 0;
    }
  }

  // Sends every chunk in range immediately, used during the initial spawn
  public sendAll(): void {
    // The publisher update tells the client what is about to arrive
    this.player.sendImmediate(this.createPublisherUpdate());

    const packets: Array<DataPacket> = [];
    for (const key of this.visible()) {
      // Skip anything the client already holds
      if (this.loaded.has(key)) continue;

      packets.push(this.createChunkPacket(key));
      this.loaded.add(key);
    }

    if (packets.length > 0) this.player.sendImmediate(...packets);
    this.sincePublish = 0;
  }

  // Drops every chunk from the client's view
  public clear(): void {
    this.loaded.clear();
  }

  // Pushes a bounded number of newly visible chunks to the client
  private stream(): void {
    const packets: Array<DataPacket> = [];

    for (const key of this.visible()) {
      // Stop once this tick's budget has been spent
      if (packets.length >= CHUNKS_PER_TICK) break;

      // Skip anything the client already holds
      if (this.loaded.has(key)) continue;

      packets.push(this.createChunkPacket(key));
      this.loaded.add(key);
    }

    if (packets.length > 0) this.player.send(...packets);
  }

  // Forgets chunks that have fallen outside the player's view radius
  private evict(): void {
    const cx = Math.floor(this.player.position.x) >> 4;
    const cz = Math.floor(this.player.position.z) >> 4;
    const limit = this.viewDistance + 1;

    for (const key of this.loaded) {
      const { x, z } = ChunkCoords.unhash(key);

      // Compare squared distances so no square root is needed
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz <= limit * limit) continue;

      this.loaded.delete(key);
    }
  }

  // The keys of every chunk within the view radius, nearest first
  private visible(): Array<bigint> {
    const cx = Math.floor(this.player.position.x) >> 4;
    const cz = Math.floor(this.player.position.z) >> 4;
    const offsets = ChunkView.getOffsets(this.viewDistance);
    const keys: Array<bigint> = [];

    for (let index = 0; index < offsets.length; index += 2) {
      keys.push(
        ChunkCoords.hash({ x: cx + offsets[index], z: cz + offsets[index + 1] })
      );
    }

    return keys;
  }

  // Builds the level chunk packet carrying the chunk at the given key
  private createChunkPacket(key: bigint): LevelChunkPacket {
    const { x, z } = ChunkCoords.unhash(key);
    const chunk = this.player.realm.getChunk(x, z);

    const packet = new LevelChunkPacket();
    packet.x = chunk.x;
    packet.z = chunk.z;
    packet.dimension = chunk.dimension;
    packet.subChunkCount = chunk.getSectionSendCount();
    packet.cacheEnabled = false;
    packet.data = Chunk.serialize(chunk);

    return packet;
  }

  // Builds the packet telling the client which chunks to keep resident
  private createPublisherUpdate(): NetworkChunkPublisherUpdatePacket {
    const { x, y, z } = this.player.position;

    const packet = new NetworkChunkPublisherUpdatePacket();
    packet.coordinate = new BlockPosition(
      Math.floor(x),
      Math.floor(y),
      Math.floor(z)
    );
    packet.radius = this.viewDistance << 4;
    packet.savedChunks = [...this.loaded].map((key) => ChunkCoords.unhash(key));

    return packet;
  }

  // Builds the spiral of chunk offsets covering a circular view radius
  private static getOffsets(radius: number): Int16Array {
    // Reuse the offsets for this radius, since they never change
    const cached = ChunkView.offsets.get(radius);
    if (cached) return cached;

    // Collect every offset inside the circle along with its squared distance
    const limit = (radius + 0.5) * (radius + 0.5);
    const found: Array<[number, number, number]> = [];

    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        const distance = x * x + z * z;
        if (distance <= limit) found.push([distance, x, z]);
      }
    }

    // Order them nearest first so the client fills in around the player
    found.sort((a, b) => a[0] - b[0]);

    // Pack the pairs into a flat array to keep the hot loop allocation free
    const packed = new Int16Array(found.length * 2);
    for (let index = 0; index < found.length; index++) {
      packed[index * 2] = found[index][1];
      packed[index * 2 + 1] = found[index][2];
    }

    ChunkView.offsets.set(radius, packed);

    return packed;
  }
}

export { ChunkView, CHUNKS_PER_TICK };
