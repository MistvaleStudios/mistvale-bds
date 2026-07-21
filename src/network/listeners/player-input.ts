import { InputData, Packet, Vector3f } from "@serenityjs/protocol";

import { EYE_HEIGHT } from "../../entity/player";
import { PacketListener } from "../listener";

import type { PlayerAuthInputPacket } from "@serenityjs/protocol";
import type { Player } from "../../entity/player";
import type { Session } from "../session";

// How far a player must move before the change is worth broadcasting
const POSITION_EPSILON = 0.01;

// How far a player must turn before the change is worth broadcasting
const ROTATION_EPSILON = 0.5;

class PlayerInputListener extends PacketListener {
  public static override readonly packet = Packet.PlayerAuthInput;

  public handle(packet: PlayerAuthInputPacket, session: Session): void {
    const player = session.player;

    // Input that arrives before the player has spawned has nothing to move
    if (!player || !player.spawned) return;

    // The client reports its eye position, so drop back down to the feet
    const position = new Vector3f(
      packet.position.x,
      packet.position.y - EYE_HEIGHT,
      packet.position.z
    );

    const rotation = {
      pitch: packet.rotation.x,
      yaw: packet.rotation.y,
      headYaw: packet.headYaw
    };

    // The client sends input every tick, so only act on genuine changes
    const moved =
      Math.abs(position.x - player.position.x) > POSITION_EPSILON ||
      Math.abs(position.y - player.position.y) > POSITION_EPSILON ||
      Math.abs(position.z - player.position.z) > POSITION_EPSILON;

    const turned =
      Math.abs(rotation.pitch - player.rotation.pitch) > ROTATION_EPSILON ||
      Math.abs(rotation.yaw - player.rotation.yaw) > ROTATION_EPSILON ||
      Math.abs(rotation.headYaw - player.rotation.headYaw) > ROTATION_EPSILON;

    // A player resting on a surface collides vertically without jumping
    player.onGround =
      packet.inputData.hasFlag(InputData.VerticalCollision) &&
      !packet.inputData.hasFlag(InputData.Jumping);

    // Flight has to be applied before the pose, since it suppresses crouching
    if (packet.inputData.hasFlag(InputData.StartFlying)) player.setFlying(true);
    if (packet.inputData.hasFlag(InputData.StopFlying)) player.setFlying(false);

    this.updateSneaking(packet, player);

    player.position = position;
    player.rotation = rotation;
    player.inputTick = packet.inputTick;

    // Only other clients need telling, since this one already moved itself
    if (moved || turned) {
      player.realm.broadcastExcept(player, player.createMovePacket());
    }
  }

  // Tracks whether the sneak input is held. Whether that becomes a visible
  // crouch is decided by the player, since flying suppresses the pose.
  private updateSneaking(packet: PlayerAuthInputPacket, player: Player): void {
    // On the ground the client announces the transition explicitly
    if (packet.inputData.hasFlag(InputData.StartSneaking)) {
      return player.setSneakInput(true);
    }

    if (packet.inputData.hasFlag(InputData.StopSneaking)) {
      return player.setSneakInput(false);
    }

    // While flying those actions are never sent, so the per-tick flag is the
    // only signal available. It flickers between ticks, which is why it must
    // not drive the pose directly.
    if (player.isFlying()) {
      player.setSneakInput(packet.inputData.hasFlag(InputData.Sneaking));
    }
  }
}

export { PlayerInputListener };
