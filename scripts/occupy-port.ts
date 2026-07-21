import { createSocket } from "node:dgram";

// Holds a UDP port so the server's bind failure handling can be exercised
const port = Number(process.argv[2] ?? 19_132);
const socket = createSocket("udp4");

socket.bind(port, "0.0.0.0", () => {
  console.log(`occupying udp ${port}, release with ctrl+c`);
});

// Release the port on shutdown so the next run is not blocked
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    socket.close();
    process.exit(0);
  });
}
