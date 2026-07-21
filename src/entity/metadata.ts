import { ActorDataId, ActorDataType, DataItem } from "@serenityjs/protocol";

import type { ActorFlag } from "@serenityjs/protocol";

// The number of flags a single packed long can carry
const FLAGS_PER_SET = 64;

class ActorMetadata {
  // The flags currently enabled on this actor
  private readonly flags = new Set<ActorFlag>();

  // The non-flag data items, keyed by the field they describe
  private readonly items = new Map<ActorDataId, DataItem>();

  // Whether the given flag is currently enabled
  public getFlag(flag: ActorFlag): boolean {
    return this.flags.has(flag);
  }

  // Enables or disables a flag
  public setFlag(flag: ActorFlag, enabled = true): this {
    if (enabled) this.flags.add(flag);
    else this.flags.delete(flag);

    return this;
  }

  // Sets a data field to a byte value
  public setByte(id: ActorDataId, value: number): this {
    return this.set(id, ActorDataType.Byte, value);
  }

  // Sets a data field to an integer value
  public setInt(id: ActorDataId, value: number): this {
    return this.set(id, ActorDataType.Int, value);
  }

  // Sets a data field to a floating point value
  public setFloat(id: ActorDataId, value: number): this {
    return this.set(id, ActorDataType.Float, value);
  }

  // Sets a data field to a string value
  public setString(id: ActorDataId, value: string): this {
    return this.set(id, ActorDataType.String, value);
  }

  // Sets a data field to an arbitrary typed value
  public set(id: ActorDataId, type: ActorDataType, value: unknown): this {
    this.items.set(id, new DataItem(id, type, value));

    return this;
  }

  // Builds the wire form, with the flags packed into their reserved fields
  public toDataItems(): Array<DataItem> {
    // The flags occupy two reserved long fields, split at flag sixty four
    let primary = 0n;
    let secondary = 0n;

    for (const flag of this.flags) {
      const bit = 1n << BigInt(flag % FLAGS_PER_SET);

      if (flag >= FLAGS_PER_SET) secondary |= bit;
      else primary |= bit;
    }

    const items: Array<DataItem> = [
      new DataItem(ActorDataId.Reserved0, ActorDataType.Long, primary)
    ];

    // The second field is only sent when a flag actually lands in it
    if (secondary !== 0n) {
      items.push(
        new DataItem(ActorDataId.Reserved092, ActorDataType.Long, secondary)
      );
    }

    // Followed by every non-flag field that has been set
    for (const item of this.items.values()) items.push(item);

    return items;
  }
}

export { ActorMetadata };
