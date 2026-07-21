import { BlockFace } from "@serenityjs/protocol";

import type { IPosition } from "@serenityjs/protocol";

// The direction each block face points, in block coordinates
const FACE_OFFSETS: Record<BlockFace, [number, number, number]> = {
  [BlockFace.Bottom]: [0, -1, 0],
  [BlockFace.Top]: [0, 1, 0],
  [BlockFace.North]: [0, 0, -1],
  [BlockFace.South]: [0, 0, 1],
  [BlockFace.West]: [-1, 0, 0],
  [BlockFace.East]: [1, 0, 0]
};

// Steps one block away from a position in the direction a face points
function offsetByFace(position: IPosition, face: BlockFace): IPosition {
  // An unknown face would otherwise place the block inside the clicked one
  const offset = FACE_OFFSETS[face];
  if (!offset) return { x: position.x, y: position.y, z: position.z };

  return {
    x: position.x + offset[0],
    y: position.y + offset[1],
    z: position.z + offset[2]
  };
}

// The face directly opposite the given one
function oppositeFace(face: BlockFace): BlockFace {
  switch (face) {
    case BlockFace.Bottom:
      return BlockFace.Top;
    case BlockFace.Top:
      return BlockFace.Bottom;
    case BlockFace.North:
      return BlockFace.South;
    case BlockFace.South:
      return BlockFace.North;
    case BlockFace.West:
      return BlockFace.East;
    default:
      return BlockFace.West;
  }
}

export { offsetByFace, oppositeFace, FACE_OFFSETS };
