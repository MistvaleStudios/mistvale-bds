import { MistvaleServer } from "../src";

// Load the server config, writing out the defaults on a first run
const server = MistvaleServer.fromFile("server.json");

// A failed bind leaves nothing to run, so leave with a non-zero status
server.onFatal = () => process.exit(server.exitCode);

server.start();

// Shut down cleanly so connected players get a disconnect reason
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.stop();
    process.exit(0);
  });
}
