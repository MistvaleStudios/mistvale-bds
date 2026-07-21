import { BiomeType } from "../../registry/biome-type";
import { Chunk } from "../chunk";
import { TerrainGenerator } from "../generator";

// The biome painted across the entire world
const BIOME = "minecraft:the_void";

class VoidGenerator extends TerrainGenerator {
  public static override readonly identifier = "void";

  public generate(x: number, z: number): Chunk {
    const chunk = new Chunk(x, z, this.properties.dimension);

    // Nothing is placed, so the chunk is left entirely empty
    chunk.fillBiome(BiomeType.fromIdentifier(BIOME)?.networkId ?? 0);
    chunk.dirty = false;

    return chunk;
  }
}

export { VoidGenerator };
