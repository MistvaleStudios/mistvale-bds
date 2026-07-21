import { BinaryStream } from "@serenityjs/binarystream";
import { ByteTag, CompoundTag, IntTag, StringTag } from "@serenityjs/nbt";
import { BLOCK_STATE_VERSION } from "@serenityjs/protocol";

import type { BlockType } from "./block-type";

// The value types a single block state property may hold
type BlockStateValue = string | number | boolean;

// A map of block state property names to their values
type BlockStateValues = Record<string, BlockStateValue>;

// The FNV-1a seed the vanilla client uses when hashing block states
const HASH_SEED = 0x81_1c_9d_c5;

class BlockState {
  // Every registered block state, keyed by its network hash
  public static readonly states = new Map<number, BlockState>();

  // The block type this state belongs to
  public readonly type: BlockType;

  // The state property values that distinguish this state from its siblings
  public readonly values: BlockStateValues;

  // The network hash the client uses to identify this state
  public readonly networkId: number;

  // The position of this state within its block type's state list
  public readonly index: number;

  public constructor(
    type: BlockType,
    values: BlockStateValues,
    networkId: number
  ) {
    this.type = type;
    this.values = values;
    this.networkId = networkId;
    this.index = type.states.length;
  }

  // The identifier of the block type this state belongs to
  public get identifier(): string {
    return this.type.identifier;
  }

  // Checks whether this state carries every property in the given partial map
  public matches(values: BlockStateValues): boolean {
    for (const key of Object.keys(values)) {
      if (this.values[key] !== values[key]) return false;
    }

    return true;
  }

  // Resolves a state by its network hash, falling back to air when unknown
  public static resolve(networkId: number): BlockState {
    return BlockState.states.get(networkId) ?? BlockState.air();
  }

  // Returns the canonical air block state
  public static air(): BlockState {
    return BlockState.states.get(BlockState.hash("minecraft:air", {}))!;
  }

  // Writes a state into the NBT form the client and disk format expect
  public static toNbt(state: BlockState): CompoundTag {
    // Create the root tag holding the identifier and state version
    const root = new CompoundTag();
    root.add(new StringTag(state.identifier, "name"));
    root.add(new IntTag(BLOCK_STATE_VERSION, "version"));

    // Nest the individual property values under a "states" compound
    const values = root.add(new CompoundTag("states"));
    for (const [key, value] of Object.entries(state.values)) {
      values.add(BlockState.toTag(key, value));
    }

    return root;
  }

  // Computes the network hash the client derives from a block state
  public static hash(identifier: string, values: BlockStateValues): number {
    // Build the canonical NBT representation the hash is taken over
    const root = new CompoundTag();
    root.add(new StringTag(identifier, "name"));

    // The property values must be nested in a "states" compound
    const states = root.add(new CompoundTag("states"));
    for (const [key, value] of Object.entries(values)) {
      states.add(BlockState.toTag(key, value));
    }

    // Serialize the tag so the hash runs over the exact client-side bytes
    const stream = new BinaryStream();
    CompoundTag.write(stream, root);

    // Run the vanilla FNV-1a variant over the serialized buffer
    let hash = HASH_SEED;
    for (const byte of stream.getBuffer()) {
      hash ^= byte & 0xff;
      hash +=
        (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
      hash = hash | 0;
    }

    return hash;
  }

  // Wraps a raw state value in the NBT tag type the client expects
  private static toTag(
    key: string,
    value: BlockStateValue
  ): ByteTag | IntTag | StringTag {
    if (typeof value === "boolean") return new ByteTag(value ? 1 : 0, key);
    if (typeof value === "number") return new IntTag(value, key);

    return new StringTag(value, key);
  }
}

export { BlockState, BlockStateValue, BlockStateValues };
