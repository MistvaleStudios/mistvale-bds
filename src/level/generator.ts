import type { DimensionType } from "@serenityjs/protocol";
import type { Chunk } from "./chunk";

// The settings handed to every terrain generator on construction
interface GeneratorProperties {
  // The seed driving any randomness the generator uses
  seed: number;

  // The dimension the generated chunks belong to
  dimension: DimensionType;
}

abstract class TerrainGenerator {
  // The identifier operators use to select this generator in the config
  public static readonly identifier: string = "unknown";

  // The settings this generator was constructed with
  public readonly properties: GeneratorProperties;

  public constructor(properties: GeneratorProperties) {
    this.properties = properties;
  }

  // Produces the chunk at the given chunk coordinates
  public abstract generate(x: number, z: number): Chunk;
}

// The generator implementations available to the config
const GENERATORS = new Map<string, typeof TerrainGenerator>();

// Makes a generator selectable by its identifier
function registerGenerator(generator: typeof TerrainGenerator): void {
  GENERATORS.set(generator.identifier, generator);
}

// Constructs the generator registered under the given identifier
function createGenerator(
  identifier: string,
  properties: GeneratorProperties
): TerrainGenerator {
  const generator = GENERATORS.get(identifier);

  // Fail loudly rather than silently handing back an empty world
  if (!generator) {
    throw new Error(
      `Unknown terrain generator "${identifier}". Available: ${[...GENERATORS.keys()].join(", ")}`
    );
  }

  return new (generator as unknown as new (
    properties: GeneratorProperties
  ) => TerrainGenerator)(properties);
}

export {
  TerrainGenerator,
  GeneratorProperties,
  GENERATORS,
  registerGenerator,
  createGenerator
};
