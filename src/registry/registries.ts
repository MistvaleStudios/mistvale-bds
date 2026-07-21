import { BinaryStream } from "@serenityjs/binarystream";
import { CompoundTag } from "@serenityjs/nbt";
import {
  BIOME_TYPES,
  BLOCK_METADATA,
  BLOCK_PERMUTATIONS,
  BLOCK_TYPES,
  ITEM_METADATA,
  ITEM_TYPES
} from "@serenityjs/data";
import {
  BiomeDefinitionData,
  BiomeDefinitionList,
  BiomeDefinitionListPacket,
  Color,
  ItemData,
  ItemRegistryPacket
} from "@serenityjs/protocol";

import { Logger } from "../core/logger";

import { BlockType } from "./block-type";
import { BlockState } from "./block-state";
import { ItemType } from "./item-type";
import { BiomeType } from "./biome-type";

import type { BlockStateValues } from "./block-state";

// Block types whose dropped item uses a different identifier than the block
const BLOCK_ITEM_ALIASES: Record<string, string> = {
  "minecraft:reeds": "minecraft:sugar_cane"
};

// Item types whose placed block uses a different identifier than the item
const ITEM_BLOCK_ALIASES: Record<string, string> = {
  "minecraft:sugar_cane": "minecraft:reeds"
};

class Registries {
  // Whether the vanilla data has already been loaded into the registries
  private static loaded = false;

  // The cached item registry packet handed to every joining client
  private static itemRegistry: ItemRegistryPacket | null = null;

  // The cached biome definition packet handed to every joining client
  private static biomeDefinitions: BiomeDefinitionListPacket | null = null;

  // The logger used while populating the registries
  private static readonly logger = new Logger("Registry", "§d");

  // Populates every registry from the vanilla data set
  public static load(): void {
    // Loading twice would duplicate every entry, so bail out early
    if (Registries.loaded) return;
    Registries.loaded = true;

    Registries.loadBlocks();
    Registries.loadItems();
    Registries.loadBiomes();

    Registries.logger.info(
      `Registered §u${BlockType.types.size}§r block types, §u${BlockState.states.size}§r block states, §u${ItemType.types.size}§r item types and §u${BiomeType.types.size}§r biomes.`
    );
  }

  // Registers every vanilla block type and each of its states
  private static loadBlocks(): void {
    // Register the types first, since states need a type to attach to
    for (const entry of BLOCK_TYPES) {
      // Look up the hardness and friction values for this block
      const metadata = BLOCK_METADATA.find(
        (meta) => meta.identifier === entry.identifier
      );

      // Build the type from the vanilla definition
      const type = new BlockType(
        entry.identifier,
        {
          air: entry.air,
          liquid: entry.liquid,
          solid: entry.solid,
          hardness: metadata?.hardness ?? 0,
          friction: metadata?.friction ?? 0.6,
          tags: entry.tags ?? []
        },
        entry.states ?? []
      );

      BlockType.types.set(type.identifier, type);
    }

    // Then register every state, attaching each to its owning type
    for (const entry of BLOCK_PERMUTATIONS) {
      // Skip states whose block type was not present in the data set
      const type = BlockType.types.get(entry.identifier);
      if (!type) continue;

      // Build the state and register it under its network hash
      const values = (entry.state ?? {}) as BlockStateValues;
      const state = new BlockState(type, values, entry.hash);

      type.register(state);
      BlockState.states.set(state.networkId, state);
    }
  }

  // Registers every vanilla item type
  private static loadItems(): void {
    for (const entry of ITEM_TYPES) {
      // The metadata carries the network id, so items without it are unusable
      const metadata = ITEM_METADATA.find(
        (meta) => meta.identifier === entry.identifier
      );
      if (!metadata) continue;

      // Resolve the block this item places, honouring the alias table
      const blockType =
        BlockType.get(entry.identifier) ??
        BlockType.get(ITEM_BLOCK_ALIASES[entry.identifier] ?? "");

      // Decode the vanilla component definitions from their base64 payload
      const stream = new BinaryStream(
        Buffer.from(metadata.properties, "base64")
      );

      const type = new ItemType(entry.identifier, {
        networkId: metadata.networkId,
        componentBased: metadata.isComponentBased,
        version: metadata.itemVersion,
        maxStackSize: entry.maxAmount,
        tags: entry.tags ?? [],
        properties: CompoundTag.read(stream),
        blockType
      });

      ItemType.types.set(type.identifier, type);
    }
  }

  // Registers every vanilla biome type
  private static loadBiomes(): void {
    for (const entry of BIOME_TYPES) {
      const type = new BiomeType(entry.identifier, entry.networkId, {
        temperature: entry.temperature,
        downfall: entry.downfall,
        snowFoilage: entry.snowFoilage,
        depth: entry.depth,
        scale: entry.scale,
        waterColor: entry.waterColor,
        canPrecipitate: entry.canPrecipitate,
        tags: entry.tags ?? []
      });

      BiomeType.types.set(type.networkId, type);
    }
  }

  // Builds the item registry packet sent during the join sequence
  public static getItemRegistry(): ItemRegistryPacket {
    // Reuse the cached packet, since it is identical for every client
    if (Registries.itemRegistry) return Registries.itemRegistry;

    // Map every registered item type into its network definition
    const packet = new ItemRegistryPacket();
    packet.definitions = ItemType.all().map(
      (type) =>
        new ItemData(
          type.identifier,
          type.networkId,
          type.properties.componentBased,
          type.properties.version,
          type.properties.componentBased
            ? type.properties.properties
            : new CompoundTag()
        )
    );

    // Serialize once up front so the cached packet can be reused verbatim
    packet.serialize();
    Registries.itemRegistry = packet;

    return packet;
  }

  // Builds the biome definition packet sent during the join sequence
  public static getBiomeDefinitions(): BiomeDefinitionListPacket {
    // Reuse the cached packet, since it is identical for every client
    if (Registries.biomeDefinitions) return Registries.biomeDefinitions;

    const packet = new BiomeDefinitionListPacket();
    packet.identifiers = [];
    packet.definitions = [];

    // Interns a string into the shared identifier table, returning its index
    const intern = (value: string): number => {
      const existing = packet.identifiers.indexOf(value);
      if (existing !== -1) return existing;

      return packet.identifiers.push(value) - 1;
    };

    for (const type of BiomeType.all()) {
      const { properties } = type;

      // Vanilla biomes carry 65535 here, since only custom biomes are indexed
      const definition = new BiomeDefinitionData(
        65_535,
        properties.temperature,
        properties.downfall,
        properties.snowFoilage,
        properties.depth,
        properties.scale,
        Color.fromInt(properties.waterColor),
        properties.canPrecipitate,
        properties.tags.map(intern),
        false
      );

      packet.definitions.push(
        new BiomeDefinitionList(intern(type.identifier), definition)
      );
    }

    // Serialize once up front so the cached packet can be reused verbatim
    packet.serialize();
    Registries.biomeDefinitions = packet;

    return packet;
  }
}

export { Registries };
