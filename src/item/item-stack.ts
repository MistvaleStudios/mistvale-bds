import { NetworkItemStackDescriptorCereal } from "@serenityjs/protocol";

import { ItemType } from "../registry/item-type";

import type { CreativeEntry } from "../registry/creative";

// The properties a stack may be created with
interface ItemStackProperties {
  // How many items the stack holds
  amount: number;

  // The auxiliary value, which selects a variant or block state
  metadata: number;
}

class ItemStack {
  // The counter handing out the ids the client tracks stacks by
  private static nextStackId = 1;

  // The item type this stack holds
  public readonly type: ItemType;

  // The id the client uses to follow this stack between slots
  public readonly stackId: number;

  // How many items the stack holds
  public amount: number;

  // The auxiliary value, which selects a variant or block state
  public metadata: number;

  public constructor(
    type: ItemType,
    properties: Partial<ItemStackProperties> = {}
  ) {
    this.type = type;
    this.amount = properties.amount ?? 1;
    this.metadata = properties.metadata ?? 0;
    this.stackId = ItemStack.nextStackId++;
  }

  // Whether this stack holds nothing
  public isEmpty(): boolean {
    return this.amount <= 0 || this.type.identifier === "minecraft:air";
  }

  // The most this stack may hold. Data gaps would otherwise produce a zero
  // sized stack, which reads as empty and vanishes the moment it is stored.
  public get maxAmount(): number {
    return Math.max(1, this.type.properties.maxStackSize);
  }

  // Whether two stacks hold the same thing and could be merged
  public matches(other: ItemStack): boolean {
    return (
      this.type.identifier === other.type.identifier &&
      this.metadata === other.metadata
    );
  }

  // Produces a copy, optionally holding a different amount
  public clone(amount = this.amount): ItemStack {
    return new ItemStack(this.type, { amount, metadata: this.metadata });
  }

  // The block state this item places, when it places one
  public get networkBlockId(): number {
    const blockType = this.type.properties.blockType;
    if (!blockType) return 0;

    // The auxiliary value selects which state of the block is placed
    const state = blockType.states[this.metadata] ?? blockType.defaultState;

    return state?.networkId ?? 0;
  }

  // Builds the wire form the inventory packets carry
  public toNetworkDescriptor(): NetworkItemStackDescriptorCereal {
    return new NetworkItemStackDescriptorCereal(
      this.type.networkId,
      this.amount,
      this.metadata,
      0,
      this.stackId,
      this.networkBlockId,
      null
    );
  }

  // The descriptor representing an empty slot
  public static empty(): NetworkItemStackDescriptorCereal {
    return new NetworkItemStackDescriptorCereal(0);
  }

  // Builds a stack from an entry the player picked out of the creative menu
  public static fromCreative(entry: CreativeEntry, amount?: number): ItemStack {
    const stack = new ItemStack(entry.type, {
      amount: amount ?? entry.type.properties.maxStackSize,
      metadata: entry.descriptor.metadata ?? 0
    });

    // Never hand out more than the item is allowed to stack to
    stack.amount = Math.max(1, Math.min(stack.amount, stack.maxAmount));

    return stack;
  }
}

export { ItemStack, ItemStackProperties };
