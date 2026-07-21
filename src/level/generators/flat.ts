import { BlockType } from "../../registry/block-type";
import { BiomeType } from "../../registry/biome-type";
import { Chunk } from "../chunk";
import { TerrainGenerator } from "../generator";

import type { BlockState } from "../../registry/block-state";

// The block placed at each Y level, starting from the world floor upwards
const LAYERS = [
  "minecraft:bedrock",
  "minecraft:dirt",
  "minecraft:dirt",
  "minecraft:grass_block"
];

// The biome painted across the entire world
const BIOME = "minecraft:plains";

class FlatGenerator extends TerrainGenerator {
  public static override readonly identifier = "flat";

  // The block state placed at each layer, resolved once on construction
  private readonly states: Array<BlockState> = [];

  // The network id of the biome painted across the world
  private readonly biome: number;

  public constructor(...args: ConstructorParameters<typeof TerrainGenerator>) {
    super(...args);

    // Resolve every layer up front so generation stays a pure array lookup
    for (const identifier of LAYERS) {
      const type = BlockType.get(identifier);

      // A missing block type means the registries were not loaded first
      if (!type) throw new Error(`Missing block type "${identifier}".`);

      this.states.push(type.defaultState);
    }

    this.biome = BiomeType.fromIdentifier(BIOME)?.networkId ?? 0;
  }

  public generate(x: number, z: number): Chunk {
    const chunk = new Chunk(x, z, this.properties.dimension);

    // Lay each configured layer down across the whole chunk footprint
    for (let index = 0; index < this.states.length; index++) {
      const y = chunk.floor + index;

      for (let bx = 0; bx < 16; bx++) {
        for (let bz = 0; bz < 16; bz++) {
          chunk.setState(bx, y, bz, this.states[index]);
        }
      }
    }

    // Paint the biome across every section so foliage colours resolve
    chunk.fillBiome(this.biome);

    // Freshly generated chunks carry no unsaved player changes
    chunk.dirty = false;

    return chunk;
  }
}

export { FlatGenerator };
