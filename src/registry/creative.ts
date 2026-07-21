import { BinaryStream } from "@serenityjs/binarystream";
import { CREATIVE_CONTENT, CREATIVE_GROUPS } from "@serenityjs/data";
import {
  CreativeContentPacket,
  CreativeGroup,
  CreativeItem,
  NetworkItemInstanceDescriptor
} from "@serenityjs/protocol";

import { Logger } from "../core/logger";

import { ItemType } from "./item-type";

import type { CreativeItemCategory } from "@serenityjs/protocol";

// One entry in the creative menu, addressable by the index the client sends
interface CreativeEntry {
  // The item type this entry hands out
  type: ItemType;

  // The exact instance the client showed, including any state metadata
  descriptor: NetworkItemInstanceDescriptor;

  // The group this entry is filed under
  groupIndex: number;
}

// A tab within the creative menu
interface CreativeGroupEntry {
  // The translation key naming the group
  identifier: string;

  // The tab the group belongs to
  category: CreativeItemCategory;

  // The item type shown as the group's icon
  icon: ItemType;
}

class CreativeRegistry {
  // Whether the creative data has already been loaded
  private static loaded = false;

  // The groups making up the creative menu, in index order
  private static readonly groups: Array<CreativeGroupEntry> = [];

  // Every creative entry, indexed exactly as the client addresses them
  private static readonly entries: Array<CreativeEntry> = [];

  // The cached packet handed to every joining client
  private static packet: CreativeContentPacket | null = null;

  // The logger used while populating the menu
  private static readonly logger = new Logger("Creative", "§d");

  // Populates the creative menu from the vanilla data set
  public static load(): void {
    // Loading twice would duplicate every entry in the menu
    if (CreativeRegistry.loaded) return;
    CreativeRegistry.loaded = true;

    // The groups must be registered first, since entries index into them
    for (const group of CREATIVE_GROUPS) {
      // A group whose icon is unknown cannot be rendered, but the index must
      // still advance or every following entry would land in the wrong tab
      const icon = ItemType.get(group.icon);

      CreativeRegistry.groups.push({
        identifier: group.name,
        category: group.category,
        icon: icon ?? ItemType.get("minecraft:air")!
      });
    }

    // Then the entries, whose order defines the index the client sends back
    for (const content of CREATIVE_CONTENT) {
      // Entries for unknown item types cannot be handed out
      const type = ItemType.get(content.type);
      if (!type) continue;

      // The instance is a pre-serialized descriptor carrying the exact state
      const stream = new BinaryStream(Buffer.from(content.instance, "base64"));

      CreativeRegistry.entries.push({
        type,
        descriptor: NetworkItemInstanceDescriptor.read(stream),
        groupIndex: content.groupIndex
      });
    }

    CreativeRegistry.logger.info(
      `Registered §u${CreativeRegistry.entries.length}§r creative entries across §u${CreativeRegistry.groups.length}§r groups.`
    );
  }

  // Resolves the entry the client asked for by its creative index
  public static getEntry(index: number): CreativeEntry | null {
    return CreativeRegistry.entries[index] ?? null;
  }

  // The number of entries in the menu
  public static get size(): number {
    return CreativeRegistry.entries.length;
  }

  // Builds the packet describing the whole creative menu
  public static getContentPacket(): CreativeContentPacket {
    // Reuse the cached packet, since the menu is identical for every client
    if (CreativeRegistry.packet) return CreativeRegistry.packet;

    const packet = new CreativeContentPacket();

    // The group icons are sent as item instances rather than identifiers
    packet.groups = CreativeRegistry.groups.map(
      (group) =>
        new CreativeGroup(
          group.category,
          group.identifier,
          new NetworkItemInstanceDescriptor(group.icon.networkId, 1, 0, 0, null)
        )
    );

    // The item index must match the position the entry was registered at,
    // since that is the index the client sends back when picking an item
    packet.items = CreativeRegistry.entries.map(
      (entry, index) =>
        new CreativeItem(index, entry.descriptor, entry.groupIndex)
    );

    // Serialize once up front so the cached packet can be reused verbatim
    packet.serialize();
    CreativeRegistry.packet = packet;

    return packet;
  }
}

export { CreativeRegistry, CreativeEntry, CreativeGroupEntry };
