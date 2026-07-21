import { Difficulty, DimensionType, Gamemode, Vector3f } from "@serenityjs/protocol";

import { Logger } from "../core/logger";

import { createGenerator } from "./generator";
import { Realm } from "./realm";

import type { ServerConfig } from "../core/config";

// The game rules a level exposes to the client
type LevelGamerules = Record<string, boolean | number>;

// The game rules a freshly created level starts with
const DEFAULT_GAMERULES: LevelGamerules = {
  doDayLightCycle: true,
  doWeatherCycle: true,
  doMobSpawning: true,
  doMobLoot: true,
  doTileDrops: true,
  doImmediateRespawn: false,
  keepInventory: false,
  naturalRegeneration: true,
  pvp: true,
  showCoordinates: true,
  showDaysPlayed: true,
  fallDamage: true,
  fireDamage: true,
  drowningDamage: true,
  tntExplodes: true,
  respawnBlocksExplode: true,
  freezeDamage: true,
  commandBlocksEnabled: true,
  sendCommandFeedback: true,
  commandBlockOutput: true,
  doInsomnia: true,
  doEntityDrops: true,
  doFireTick: true,
  mobGriefing: true,
  showDeathMessages: true,
  functionCommandLimit: 10_000,
  maxCommandChainLength: 65_535,
  randomTickSpeed: 1,
  spawnRadius: 5,
  playersSleepingPercentage: 100
};

class Level {
  // The name shown on the client's world screen
  public readonly identifier: string;

  // The seed handed to every realm's terrain generator
  public readonly seed: number;

  // The realms belonging to this level, keyed by their identifier
  public readonly realms = new Map<string, Realm>();

  // The game rules currently in effect
  public readonly gamerules: LevelGamerules = { ...DEFAULT_GAMERULES };

  // The logger scoped to this level
  public readonly logger: Logger;

  // The number of ticks elapsed since the level was created
  public currentTick = 0n;

  // The in-game time of day, in ticks
  public dayTime = 0;

  // The gamemode players are placed into on their first join
  public defaultGamemode: Gamemode = Gamemode.Creative;

  // The difficulty currently in effect
  public difficulty: Difficulty = Difficulty.Normal;

  public constructor(identifier: string, seed: number) {
    this.identifier = identifier;
    this.seed = seed;
    this.logger = new Logger(identifier, "§6");
  }

  // The realm players join into when no other realm is specified
  public get overworld(): Realm {
    return this.realms.get("overworld")!;
  }

  // Returns the realm registered under the given identifier
  public getRealm(identifier = "overworld"): Realm | null {
    return this.realms.get(identifier) ?? null;
  }

  // Registers a realm with this level
  public addRealm(realm: Realm): Realm {
    this.realms.set(realm.identifier, realm);

    return realm;
  }

  // Advances the level and every realm within it by a single tick
  public tick(): void {
    this.currentTick++;

    // Advance the clock when the day light cycle rule permits it
    if (this.gamerules.doDayLightCycle) {
      this.dayTime = (this.dayTime + 1) % 24_000;
    }

    // Let every player in every realm run its per-tick work
    for (const realm of this.realms.values()) {
      for (const player of realm.players) player.tick();
    }
  }

  // Builds a level with a single overworld realm from the server config
  public static fromConfig(config: ServerConfig): Level {
    const level = new Level(config.levelName, config.seed);

    // Build the overworld's generator from the configured identifier
    const generator = createGenerator(config.generator, {
      seed: config.seed,
      dimension: DimensionType.Overworld
    });

    // Place the spawn a little above the flat terrain surface
    const realm = new Realm(level, {
      identifier: "overworld",
      type: DimensionType.Overworld,
      generator,
      spawn: new Vector3f(0.5, -59, 0.5),
      viewDistance: config.viewDistance
    });

    level.addRealm(realm);

    // Nudge the spawn up to whatever the generator actually produced
    realm.properties.spawn = new Vector3f(0.5, realm.getSurface(0, 0) + 1, 0.5);

    return level;
  }
}

export { Level, LevelGamerules, DEFAULT_GAMERULES };
