import { CompoundTag } from "@serenityjs/nbt";

import type { BlockType } from "./block-type";

// The properties an item type carries
interface ItemTypeProperties {
  // The network identifier the client uses to reference the item
  networkId: number;

  // Whether the client resolves this item through the component system
  componentBased: boolean;

  // The item format version the client should parse the properties with
  version: number;

  // The most of this item that can occupy a single slot
  maxStackSize: number;

  // The vanilla tags attached to the item
  tags: Array<string>;

  // The vanilla component definitions sent in the item registry
  properties: CompoundTag;

  // The block this item places, when it places one
  blockType: BlockType | null;
}

class ItemType {
  // Every registered item type, keyed by its identifier
  public static readonly types = new Map<string, ItemType>();

  // The namespaced identifier of the item, such as "minecraft:diamond"
  public readonly identifier: string;

  // The properties describing how the client should treat this item
  public readonly properties: ItemTypeProperties;

  public constructor(identifier: string, properties: ItemTypeProperties) {
    this.identifier = identifier;
    this.properties = properties;
  }

  // The network identifier the client uses to reference this item
  public get networkId(): number {
    return this.properties.networkId;
  }

  // Whether this item also exists as a placeable block
  public get isBlock(): boolean {
    return this.properties.blockType !== null;
  }

  // Looks up a registered item type by its identifier
  public static get(identifier: string): ItemType | null {
    return ItemType.types.get(identifier) ?? null;
  }

  // Looks up a registered item type by its network identifier
  public static fromNetworkId(networkId: number): ItemType | null {
    for (const type of ItemType.types.values()) {
      if (type.networkId === networkId) return type;
    }

    return null;
  }

  // Returns every registered item type
  public static all(): Array<ItemType> {
    return [...ItemType.types.values()];
  }
}

export { ItemType, ItemTypeProperties };
