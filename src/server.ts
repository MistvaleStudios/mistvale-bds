// Must come first, so the base64 helpers exist before authentication runs
import "./core/polyfill";

import { PlayerListAction } from "@serenityjs/protocol";

import { Logger, LogLevel } from "./core/logger";
import { DEFAULT_CONFIG, loadConfig } from "./core/config";
import { Player } from "./entity/player";
import { Level } from "./level/level";
import { Gateway } from "./network/gateway";
import { LISTENERS } from "./network/listeners";
import { Registries } from "./registry/registries";

// Pull in the built in generators so they are selectable from the config
import "./level/generators";

import type { ServerConfig } from "./core/config";
import type { PlayerIdentity } from "./entity/identity";
import type { Session } from "./network/session";

// The first runtime id handed out, leaving room for reserved values
const FIRST_ENTITY_ID = 1n;

class MistvaleServer {
  // The settings this server is running with
  public readonly config: ServerConfig;

  // The transport layer accepting and decoding client traffic
  public readonly gateway: Gateway;

  // The level this server is hosting
  public readonly level: Level;

  // The players currently connected, keyed by their session
  public readonly players = new Map<Session, Player>();

  // The logger used for server wide reporting
  public readonly logger = new Logger("Mistvale", "§b");

  // Whether the simulation loop is currently running
  public running = false;

  // The exit code the entry point should use, set when startup fails
  public exitCode = 0;

  // Called when the server can no longer run, so the caller can react
  public onFatal: ((error: Error) => void) | null = null;

  // The handle for the simulation loop, held so it can be cleared on stop
  private ticker: NodeJS.Timeout | null = null;

  // The next entity id to hand out
  private nextEntityId = FIRST_ENTITY_ID;

  public constructor(config: Partial<ServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Apply the configured verbosity before anything else logs
    Logger.level = LogLevel[this.config.logLevel] ?? LogLevel.Info;

    // The registries must exist before any generator resolves a block type
    Registries.load();

    this.level = Level.fromConfig(this.config);
    this.gateway = new Gateway(this);
    this.gateway.dispatcher.register(...LISTENERS);
  }

  // Binds the socket and starts the simulation loop
  public start(): void {
    if (this.running) return;
    this.running = true;

    this.logger.info(`Starting §uMistvale§r on §u${this.config.levelName}§r.`);
    this.gateway.start();

    // Run the simulation at the configured rate
    const interval = Math.max(1, Math.floor(1000 / this.config.tickRate));
    this.ticker = setInterval(() => this.tick(), interval);
  }

  // Announces readiness once the transport has actually bound its socket
  public onGatewayReady(): void {
    const { x, y, z } = this.level.overworld.spawn;

    this.logger.info(
      `Ready. Spawn is §7${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}§r.`
    );
  }

  // Shuts the server down after the transport failed unrecoverably
  public onGatewayFailure(error: NodeJS.ErrnoException): void {
    // The gateway has already explained the failure, so do not repeat it
    this.exitCode = 1;

    // Nothing can be served without a socket, so wind the rest down
    this.stop("The server failed to start.");

    // Let the entry point decide how to exit, rather than killing the process
    this.onFatal?.(error);
  }

  // Disconnects every player and shuts the server down
  public stop(reason = "The server is shutting down."): void {
    if (!this.running) return;
    this.running = false;

    // Give every player a reason before the socket goes away
    for (const player of this.players.values()) {
      player.session.disconnect(reason);
    }

    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;

    this.gateway.stop();
    this.logger.info("Stopped.");
  }

  // Advances the whole server by a single tick
  private tick(): void {
    // A failure here would otherwise kill the interval entirely
    try {
      this.level.tick();
    } catch (error) {
      this.logger.error("Tick failed:", error);
    }
  }

  // Creates and registers the player belonging to a freshly logged in session
  public createPlayer(session: Session, identity: PlayerIdentity): Player {
    // Both ids come from the same counter, so they never collide
    const runtimeId = this.nextEntityId++;
    const uniqueId = runtimeId;

    const player = new Player(
      session,
      identity,
      this.level.overworld,
      runtimeId,
      uniqueId
    );

    session.player = player;
    this.players.set(session, player);

    return player;
  }

  // Cleans up the player bound to a session that has gone away
  public onSessionClosed(session: Session): void {
    const player = this.players.get(session);
    if (!player) return;

    // Take the player out of the world before dropping the reference
    player.despawn();
    this.players.delete(session);
    session.player = null;

    // Remove the departed player from every remaining player's list
    const removal = player.createPlayerListPacket(PlayerListAction.Remove);
    for (const other of this.players.values()) other.send(removal);

    this.logger.info(`§u${player.username}§r left the server.`);
  }

  // Finds a connected player by their Xbox user id
  public getPlayerByXuid(xuid: string): Player | null {
    for (const player of this.players.values()) {
      if (player.identity.xuid === xuid) return player;
    }

    return null;
  }

  // Finds a connected player by their username, ignoring case
  public getPlayerByName(username: string): Player | null {
    const needle = username.toLowerCase();

    for (const player of this.players.values()) {
      if (player.username.toLowerCase() === needle) return player;
    }

    return null;
  }

  // Builds a server from a config file, writing the defaults if it is missing
  public static fromFile(path = "server.json"): MistvaleServer {
    return new MistvaleServer(loadConfig(path));
  }
}

export { MistvaleServer };
