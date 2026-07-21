import {
  BIOME_FORMAT,
  BLOCK_FORMAT,
  PalettedStorage
} from "./paletted-storage";

import type { BinaryStream } from "@serenityjs/binarystream";

// The sub chunk format version that carries an explicit vertical index
const FORMAT_VERSION = 9;

class Section {
  // The number of blocks along each axis of a section
  public static readonly SIZE = 16;

  // The sub chunk format version this section serializes as
  public readonly version: number;

  // The block layers of the section, where layer zero holds solid blocks
  public readonly layers: Array<PalettedStorage> = [];

  // The biome assignments for every position within the section
  public biomes: PalettedStorage;

  // The vertical index of this section, relative to the world floor
  public index: number;

  public constructor(index: number, air: number, version = FORMAT_VERSION) {
    this.index = index;
    this.version = version;
    this.biomes = new PalettedStorage(0);

    // Every section carries at least the solid block layer
    this.layers.push(new PalettedStorage(air));
  }

  // Whether every layer in this section still holds only its fill value
  public isEmpty(): boolean {
    return this.layers.every((layer) => layer.isEmpty());
  }

  // Returns the requested layer, creating it and any gaps below it
  public getLayer(index: number, air: number): PalettedStorage {
    while (this.layers.length <= index) {
      this.layers.push(new PalettedStorage(air));
    }

    return this.layers[index];
  }

  // The block state hash stored at the given section-local coordinates
  public getState(x: number, y: number, z: number, layer = 0): number | null {
    const storage = this.layers[layer];

    return storage ? storage.get(x, y, z) : null;
  }

  // Stores a block state hash at the given section-local coordinates
  public setState(
    x: number,
    y: number,
    z: number,
    state: number,
    layer = 0,
    air = 0
  ): void {
    this.getLayer(layer, air).set(x, y, z, state);
  }

  // Writes the section, but not its biomes, into the stream
  public static write(section: Section, stream: BinaryStream): void {
    // The header carries the format version and the layer count
    stream.writeUint8(section.version);
    stream.writeUint8(section.layers.length);

    // Format nine follows the header with the section's vertical index
    if (section.version === FORMAT_VERSION) stream.writeInt8(section.index);

    // Then each block layer follows in order
    for (const layer of section.layers) {
      PalettedStorage.write(layer, stream, BLOCK_FORMAT);
    }
  }

  // Reads a section, but not its biomes, back out of the stream
  public static read(stream: BinaryStream, air: number): Section {
    // Read the header back out
    const version = stream.readUint8();
    const count = stream.readUint8();
    const index = version === FORMAT_VERSION ? stream.readInt8() : 0;

    // Build the section and replace its default layer with the stored ones
    const section = new Section(index, air, version);
    section.layers.length = 0;

    for (let layer = 0; layer < count; layer++) {
      section.layers.push(PalettedStorage.read(stream, BLOCK_FORMAT));
    }

    return section;
  }

  // Writes the section's biome storage into the stream
  public static writeBiomes(section: Section, stream: BinaryStream): void {
    PalettedStorage.write(section.biomes, stream, BIOME_FORMAT);
  }

  // Reads the section's biome storage back out of the stream
  public static readBiomes(section: Section, stream: BinaryStream): void {
    section.biomes = PalettedStorage.read(stream, BIOME_FORMAT);
  }
}

export { Section };
