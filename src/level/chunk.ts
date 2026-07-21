import { BinaryStream } from "@serenityjs/binarystream";
import { ChunkCoords, DimensionType } from "@serenityjs/protocol";

import { BlockState } from "../registry/block-state";

import { Section } from "./section";

// The vertical bounds each dimension type occupies
const DIMENSION_BOUNDS: Record<number, { floor: number; sections: number }> = {
  [DimensionType.Overworld]: { floor: -64, sections: 24 },
  [DimensionType.Nether]: { floor: 0, sections: 8 },
  [DimensionType.End]: { floor: 0, sections: 16 }
};

class Chunk {
  // The chunk X coordinate, in chunk space
  public readonly x: number;

  // The chunk Z coordinate, in chunk space
  public readonly z: number;

  // The dimension type this chunk belongs to, which sets its vertical bounds
  public readonly dimension: DimensionType;

  // The lowest block Y coordinate this chunk stores
  public readonly floor: number;

  // The sections making up this chunk, indexed from the world floor upwards
  public readonly sections: Array<Section | null>;

  // The packed coordinate key used to address this chunk
  public readonly key: bigint;

  // The cached serialized form, invalidated whenever the chunk changes
  private cache: Buffer | null = null;

  // Whether this chunk holds changes that have not been persisted
  public dirty = false;

  public constructor(x: number, z: number, dimension: DimensionType) {
    this.x = x;
    this.z = z;
    this.dimension = dimension;
    this.key = ChunkCoords.hash({ x, z });

    // Resolve the vertical bounds for this dimension, defaulting to overworld
    const bounds =
      DIMENSION_BOUNDS[dimension] ?? DIMENSION_BOUNDS[DimensionType.Overworld];

    this.floor = bounds.floor;
    this.sections = new Array<Section | null>(bounds.sections).fill(null);
  }

  // The highest block Y coordinate this chunk stores, exclusive
  public get ceiling(): number {
    return this.floor + this.sections.length * Section.SIZE;
  }

  // Returns the section covering the given block Y, creating it when absent
  public getSection(y: number): Section | null {
    // Reject coordinates outside this chunk's vertical bounds
    const index = (y - this.floor) >> 4;
    if (index < 0 || index >= this.sections.length) return null;

    // Create the section lazily, since most chunks are mostly empty
    if (!this.sections[index]) {
      this.sections[index] = new Section(
        index + (this.floor >> 4),
        BlockState.air().networkId
      );
    }

    return this.sections[index];
  }

  // The block state at the given chunk-local X, absolute Y and chunk-local Z
  public getState(x: number, y: number, z: number, layer = 0): BlockState {
    // Anything outside the vertical bounds reads back as air
    const index = (y - this.floor) >> 4;
    if (index < 0 || index >= this.sections.length) return BlockState.air();

    // Sections that were never touched are entirely air
    const section = this.sections[index];
    if (!section) return BlockState.air();

    // Layers above the ones present in the section also read back as air
    const state = section.getState(x, y, z, layer);
    if (state === null) return BlockState.air();

    return BlockState.resolve(state);
  }

  // Places a block state at the given chunk-local X, absolute Y and local Z
  public setState(
    x: number,
    y: number,
    z: number,
    state: BlockState,
    layer = 0
  ): void {
    // Silently drop writes that fall outside the chunk's vertical bounds
    const section = this.getSection(y);
    if (!section) return;

    section.setState(x, y, z, state.networkId, layer, BlockState.air().networkId);

    // The serialized form is now stale
    this.cache = null;
    this.dirty = true;
  }

  // The biome network id at the given chunk-local X, absolute Y and local Z
  public getBiome(x: number, y: number, z: number): number {
    const index = (y - this.floor) >> 4;
    const section = this.sections[index];

    return section ? section.biomes.get(x, y, z) : 0;
  }

  // Assigns a biome at the given chunk-local X, absolute Y and local Z
  public setBiome(x: number, y: number, z: number, biome: number): void {
    const section = this.getSection(y);
    if (!section) return;

    section.biomes.set(x, y, z, biome);
    this.cache = null;
    this.dirty = true;
  }

  // Fills every section's biome storage with a single biome
  public fillBiome(biome: number): void {
    for (let index = 0; index < this.sections.length; index++) {
      // Materialize the section so its biome storage is sent to the client
      const y = this.floor + index * Section.SIZE;
      const section = this.getSection(y);
      if (!section) continue;

      // A uniform storage collapses to a single palette entry on the wire
      section.biomes.fill(biome);
    }

    this.cache = null;
  }

  // The number of sections that must be sent for the client to render this
  public getSectionSendCount(): number {
    // Walk down from the top until a section with content is found
    for (let index = this.sections.length - 1; index >= 0; index--) {
      const section = this.sections[index];
      if (section && !section.isEmpty()) return index + 1;
    }

    return 0;
  }

  // Whether every section in this chunk is still empty
  public isEmpty(): boolean {
    return this.getSectionSendCount() === 0;
  }

  // Serializes the chunk into the payload of a level chunk packet
  public static serialize(chunk: Chunk): Buffer {
    // Reuse the cached buffer when the chunk has not changed since last time
    if (chunk.cache) return chunk.cache;

    const stream = new BinaryStream();
    const count = chunk.getSectionSendCount();
    const air = BlockState.air().networkId;

    // The block sections come first, in ascending vertical order
    for (let index = 0; index < count; index++) {
      const section =
        chunk.sections[index] ??
        new Section(index + (chunk.floor >> 4), air);

      Section.write(section, stream);
    }

    // Every section that was sent must be followed by its biome storage
    for (let index = 0; index < count; index++) {
      const section =
        chunk.sections[index] ??
        new Section(index + (chunk.floor >> 4), air);

      Section.writeBiomes(section, stream);
    }

    // A trailing byte reserved for border block data, which is unused here
    stream.writeUint8(0);

    chunk.cache = stream.getBuffer();

    return chunk.cache;
  }

  // Reconstructs a chunk from a previously serialized payload
  public static deserialize(
    x: number,
    z: number,
    dimension: DimensionType,
    buffer: Buffer,
    count: number
  ): Chunk {
    const chunk = new Chunk(x, z, dimension);
    const stream = new BinaryStream(buffer);
    const air = BlockState.air().networkId;

    // Read back the block sections that were written
    for (let index = 0; index < count; index++) {
      chunk.sections[index] = Section.read(stream, air);
    }

    // Followed by the biome storage belonging to each of them
    for (let index = 0; index < count; index++) {
      const section = chunk.sections[index];
      if (section) Section.readBiomes(section, stream);
    }

    // Consume the trailing border block byte
    stream.readUint8();
    chunk.cache = buffer;

    return chunk;
  }
}

export { Chunk, DIMENSION_BOUNDS };
