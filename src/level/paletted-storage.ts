import { Endianness } from "@serenityjs/binarystream";

import type { BinaryStream } from "@serenityjs/binarystream";

// Controls how a paletted storage is laid out on the wire
interface PalettedStorageFormat {
  // Whether the palette holds runtime ids rather than persistent values
  runtime: boolean;

  // Whether a single-entry palette may collapse to a zero-bit encoding
  collapsible: boolean;
}

// The layout used by block layers within a section
const BLOCK_FORMAT: PalettedStorageFormat = {
  runtime: true,
  collapsible: false
};

// The layout used by the biome storage within a section
const BIOME_FORMAT: PalettedStorageFormat = {
  runtime: false,
  collapsible: true
};

// The bit widths the client is able to decode
const SUPPORTED_WIDTHS = [1, 2, 3, 4, 5, 6, 8, 16];

class PalettedStorage {
  // The number of entries a single storage holds
  public static readonly VOLUME = 4096;

  // The distinct values present in this storage
  public readonly palette: Array<number>;

  // The palette index stored for each of the 4096 positions
  public readonly indices: Uint16Array;

  // Reverse lookup from value to palette index, kept in sync with the palette
  private readonly lookup = new Map<number, number>();

  public constructor(
    fill = 0,
    palette?: Array<number>,
    indices?: Uint16Array
  ) {
    // Seed the palette with the fill value so index zero is always valid
    this.palette = palette ?? [fill];
    this.indices = indices ?? new Uint16Array(PalettedStorage.VOLUME);

    // Build the reverse lookup for the palette we were handed
    for (let index = 0; index < this.palette.length; index++) {
      this.lookup.set(this.palette[index], index);
    }
  }

  // Whether the storage still holds nothing but its initial fill value
  public isEmpty(): boolean {
    return this.palette.length === 1;
  }

  // Resets the storage so every position holds the given value
  public fill(value: number): void {
    this.palette.length = 0;
    this.palette.push(value);
    this.lookup.clear();
    this.lookup.set(value, 0);
    this.indices.fill(0);
  }

  // The value stored at the given section-local coordinates
  public get(x: number, y: number, z: number): number {
    return this.palette[this.indices[PalettedStorage.offset(x, y, z)]];
  }

  // Stores a value at the given section-local coordinates
  public set(x: number, y: number, z: number, value: number): void {
    // Intern the value into the palette, appending it when it is new
    let index = this.lookup.get(value);
    if (index === undefined) {
      index = this.palette.push(value) - 1;
      this.lookup.set(value, index);
    }

    this.indices[PalettedStorage.offset(x, y, z)] = index;
  }

  // Maps section-local coordinates onto the flat storage offset
  public static offset(x: number, y: number, z: number): number {
    return (((x & 0xf) << 8) | ((z & 0xf) << 4) | (y & 0xf)) >>> 0;
  }

  // Picks the smallest bit width the client can decode for a palette size
  public static widthFor(size: number, collapsible: boolean): number {
    // A single-entry palette may collapse when the format permits it
    if (size <= 1 && collapsible) return 0;

    // Otherwise pick the narrowest supported width that fits the palette
    const needed = Math.max(1, Math.ceil(Math.log2(Math.max(size, 2))));

    return SUPPORTED_WIDTHS.find((width) => width >= needed) ?? 16;
  }

  // Writes the storage into the stream using the given wire layout
  public static write(
    storage: PalettedStorage,
    stream: BinaryStream,
    format: PalettedStorageFormat
  ): void {
    // Determine how many bits each entry occupies
    const width = PalettedStorage.widthFor(
      storage.palette.length,
      format.collapsible
    );

    // The low bit of the header flags a runtime palette
    stream.writeUint8((width << 1) | (format.runtime ? 1 : 0));

    // A zero-bit storage is uniform, so only the single value is written
    if (width === 0) {
      stream.writeInt32(storage.palette[0], Endianness.Little);

      return;
    }

    // Pack the indices into 32 bit words, leaving the spare high bits unused
    const perWord = Math.floor(32 / width);
    const words = Math.ceil(PalettedStorage.VOLUME / perWord);

    for (let word = 0; word < words; word++) {
      let packed = 0;

      for (let slot = 0; slot < perWord; slot++) {
        // Stop once the tail of the storage has been consumed
        const offset = word * perWord + slot;
        if (offset >= PalettedStorage.VOLUME) break;

        packed |= storage.indices[offset] << (slot * width);
      }

      stream.writeInt32(packed, Endianness.Little);
    }

    // Follow the words with the palette itself
    stream.writeZigZag(storage.palette.length);
    for (const value of storage.palette) stream.writeZigZag(value);
  }

  // Reads a storage back out of the stream using the given wire layout
  public static read(
    stream: BinaryStream,
    format: PalettedStorageFormat
  ): PalettedStorage {
    // The high bits of the header carry the entry width
    const header = stream.readUint8();
    const width = header >> 1;

    // A zero-bit storage is uniform, so only the single value follows
    if (width === 0) {
      return new PalettedStorage(stream.readInt32(Endianness.Little));
    }

    // Read the packed index words back out
    const perWord = Math.floor(32 / width);
    const words = Math.ceil(PalettedStorage.VOLUME / perWord);
    const packed = new Array<number>(words);

    for (let word = 0; word < words; word++) {
      packed[word] = stream.readInt32(Endianness.Little);
    }

    // Then read the palette that the indices refer into
    const size = stream.readZigZag();
    const palette = new Array<number>(size);
    for (let index = 0; index < size; index++) {
      palette[index] = stream.readZigZag();
    }

    // Unpack the words back into the flat index array
    const indices = new Uint16Array(PalettedStorage.VOLUME);
    const mask = (1 << width) - 1;
    let offset = 0;

    for (const word of packed) {
      for (
        let slot = 0;
        slot < perWord && offset < PalettedStorage.VOLUME;
        slot++, offset++
      ) {
        indices[offset] = (word >> (slot * width)) & mask;
      }
    }

    return new PalettedStorage(palette[0] ?? 0, palette, indices);
  }
}

export {
  PalettedStorage,
  PalettedStorageFormat,
  BLOCK_FORMAT,
  BIOME_FORMAT
};
