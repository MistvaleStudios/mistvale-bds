// The properties a biome type carries
interface BiomeTypeProperties {
  // The ambient temperature, which drives snow and rain behaviour
  temperature: number;

  // The amount of precipitation the biome receives
  downfall: number;

  // How frozen foliage appears within the biome
  snowFoilage: number;

  // The terrain depth offset applied by the biome
  depth: number;

  // The terrain scale multiplier applied by the biome
  scale: number;

  // The tint applied to water within the biome, in packed ARGB
  waterColor: number;

  // Whether the biome can rain or snow at all
  canPrecipitate: boolean;

  // The vanilla tags attached to the biome
  tags: Array<string>;
}

class BiomeType {
  // Every registered biome type, keyed by its network identifier
  public static readonly types = new Map<number, BiomeType>();

  // The namespaced identifier of the biome, such as "minecraft:plains"
  public readonly identifier: string;

  // The network identifier the client uses to reference the biome
  public readonly networkId: number;

  // The properties describing how the biome looks and behaves
  public readonly properties: BiomeTypeProperties;

  public constructor(
    identifier: string,
    networkId: number,
    properties: BiomeTypeProperties
  ) {
    this.identifier = identifier;
    this.networkId = networkId;
    this.properties = properties;
  }

  // Looks up a registered biome type by its network identifier
  public static get(networkId: number): BiomeType | null {
    return BiomeType.types.get(networkId) ?? null;
  }

  // Looks up a registered biome type by its identifier
  public static fromIdentifier(identifier: string): BiomeType | null {
    for (const type of BiomeType.types.values()) {
      if (type.identifier === identifier) return type;
    }

    return null;
  }

  // Returns every registered biome type
  public static all(): Array<BiomeType> {
    return [...BiomeType.types.values()];
  }
}

export { BiomeType, BiomeTypeProperties };
