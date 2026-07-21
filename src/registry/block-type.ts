import { BlockState } from "./block-state";

import type { BlockStateValues } from "./block-state";

// The physical properties a block type carries
interface BlockTypeProperties {
  // Whether the block is treated as empty space
  air: boolean;

  // Whether the block behaves as a fluid
  liquid: boolean;

  // Whether entities collide with the block
  solid: boolean;

  // How long the block takes to break with an empty hand
  hardness: number;

  // How much the block slows entities walking across it
  friction: number;

  // The vanilla tags attached to the block
  tags: Array<string>;
}

class BlockType {
  // Every registered block type, keyed by its identifier
  public static readonly types = new Map<string, BlockType>();

  // The namespaced identifier of the block, such as "minecraft:stone"
  public readonly identifier: string;

  // The physical properties shared by every state of this block
  public readonly properties: BlockTypeProperties;

  // The names of the state properties this block exposes
  public readonly stateNames: Array<string>;

  // Every state this block can take, in registration order
  public readonly states: Array<BlockState> = [];

  public constructor(
    identifier: string,
    properties: BlockTypeProperties,
    stateNames: Array<string> = []
  ) {
    this.identifier = identifier;
    this.properties = properties;
    this.stateNames = stateNames;
  }

  // The state used when no specific property values are requested
  public get defaultState(): BlockState {
    return this.states[0];
  }

  // Adds a state to this type, returning the state for chaining
  public register(state: BlockState): BlockState {
    this.states.push(state);

    return state;
  }

  // Finds the state matching the given property values
  public getState(values?: BlockStateValues): BlockState {
    // Return the default when no properties were requested
    if (!values) return this.defaultState;

    // Otherwise scan for the first state carrying every requested property
    return this.states.find((state) => state.matches(values)) ?? this.defaultState;
  }

  // Looks up a registered block type by its identifier
  public static get(identifier: string): BlockType | null {
    return BlockType.types.get(identifier) ?? null;
  }

  // Returns every registered block type
  public static all(): Array<BlockType> {
    return [...BlockType.types.values()];
  }
}

export { BlockType, BlockTypeProperties };
