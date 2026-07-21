import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { LogLevel } from "./logger";

// Every tunable knob the server exposes to the operator
interface ServerConfig {
  // The address the RakNet socket binds to
  host: string;

  // The UDP port the RakNet socket binds to
  port: number;

  // The MOTD shown in the client's server list
  motd: string;

  // The sub-title shown beneath the MOTD
  subtitle: string;

  // The maximum amount of players allowed on the server at once
  maxPlayers: number;

  // Whether clients must be authenticated against Xbox Live
  onlineMode: boolean;

  // The name of the level that is loaded on boot
  levelName: string;

  // The terrain generator used by the overworld realm
  generator: string;

  // The seed handed to the terrain generator
  seed: number;

  // The maximum chunk radius the server will serve to a client
  viewDistance: number;

  // The rate the server simulation runs at, in ticks per second
  tickRate: number;

  // How verbose the console output should be
  logLevel: keyof typeof LogLevel;
}

// The configuration applied when no config file is present
const DEFAULT_CONFIG: ServerConfig = {
  host: "0.0.0.0",
  port: 19132,
  motd: "Mistvale",
  subtitle: "A TypeScript Bedrock Server",
  maxPlayers: 20,
  onlineMode: true,
  levelName: "world",
  generator: "flat",
  seed: 0,
  viewDistance: 8,
  tickRate: 20,
  logLevel: "Info"
};

// Reads a config file from disk, writing the defaults out when it is missing
function loadConfig(path: string): ServerConfig {
  // Write out the default config when the file does not yet exist
  if (!existsSync(path)) {
    writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);

    return { ...DEFAULT_CONFIG };
  }

  // Parse the file and layer it over the defaults so new keys are picked up
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ServerConfig>;

  return { ...DEFAULT_CONFIG, ...parsed };
}

export { ServerConfig, DEFAULT_CONFIG, loadConfig };
