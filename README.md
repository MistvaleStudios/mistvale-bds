# Mistvale BDS

A Bedrock Dedicated Server software written entirely in TypeScript. We are not affiliated in any way with Microsoft or Mojang AB.

Currently targets **Minecraft Bedrock 1.26.30** (protocol **1001**).

## Status

Early. What works today:

- RakNet transport, batching, zlib compression and the full login handshake
- Xbox Live authentication, plus an optional offline mode
- A flat world with terrain streaming to the client
- The complete vanilla block, block state, item and biome registries

Not yet implemented: block interaction, inventories, entities beyond the player, world persistence, commands, encryption and resource packs.

## Getting Started

```bash
npm install
npm run build:vendor   # builds the vendored SerenityJS packages, once
npm start              # writes server.json on first run, then boots
```

The server writes a `server.json` on its first run. Set `onlineMode` to `false` if you want to connect without an Xbox Live account.

| Script | What it does |
| --- | --- |
| `npm start` | Boots the server from `server.json` |
| `npm run dev` | Same, but restarts on source changes |
| `npm run build` | Builds the vendored packages, then compiles `src/` and `app/` |
| `npm run typecheck` | Type checks without emitting |
| `npm test` | Runs every check below |
| `npm run test:polyfill` | Checks the `Uint8Array` base64 and hex polyfill |
| `npm run test:auth` | Checks the authentication library paths login depends on |
| `npm run test:packets` | Serializes every packet the join sequence sends |
| `npm run test:smoke` | Checks the registries, chunk round trip and RakNet transport |
| `npm run verify:hashes` | Recomputes every vanilla block state hash against the data set |

### A note on Node versions

`Uint8Array.fromBase64` and friends are a TC39 proposal that only ships natively in **Node 25**, and the authentication library depends on them. Rather than requiring a bleeding edge runtime, `src/core/polyfill.ts` installs a spec-shaped implementation when the runtime lacks it, so Node 22 and up both work. The polyfill validates its input rather than deferring to `Buffer`'s lenient decoders, which would otherwise let a malformed token through. On Node 25 the native methods are left untouched.

## Repository Layout

The layout is fixed — new code goes into one of these folders rather than a new top level one.

```
src/            The server software itself
  core/         Logging and configuration
  registry/     Block, item and biome type registries built from vanilla data
  level/        Worlds, dimensions, chunks and terrain generation
  entity/       Players and their per-client state
  network/      Transport, sessions and packet listeners
  server.ts     The MistvaleServer class tying it all together
  index.ts      The public surface consumers import

app/            The runnable entry point users interact with
vendor/         Vendored SerenityJS packages (see below)
scripts/        Development and verification scripts
```

### Naming conventions

Mistvale deliberately uses its own vocabulary rather than mirroring other server softwares:

| Mistvale | Means |
| --- | --- |
| `Level` | A world, holding one or more realms |
| `Realm` | A single dimension within a level |
| `Chunk` / `Section` | A 16-wide column, and one 16-cubed slice of it |
| `PalettedStorage` | The palette-and-indices container backing blocks and biomes |
| `BlockType` / `BlockState` | A block, and one specific combination of its properties |
| `Gateway` | The transport layer that batches, compresses and decodes traffic |
| `Session` | One connected client, before and after it becomes a player |
| `Dispatcher` / `PacketListener` | Packet routing, and a handler for one packet id |
| `ChunkView` | What terrain a given player currently has loaded |

### Adding a packet listener

1. Create `src/network/listeners/<name>.ts` exporting a class extending `PacketListener`.
2. Set the static `packet` field to the packet id it handles.
3. Add it to the `LISTENERS` array in `src/network/listeners/index.ts`.

## Vendored packages

`vendor/` holds four packages taken from [SerenityJS](https://github.com/SerenityJS/serenity), which is MIT licensed:

| Package | Why |
| --- | --- |
| `protocol` | Bedrock packet definitions and enums |
| `nbt` | Named binary tag reading and writing |
| `raknet` | The RakNet transport |
| `data` | The vanilla block, item, entity and biome data dumps |

They are vendored rather than pulled from npm because the published releases lag behind the Minecraft version we target. They keep their upstream `@serenityjs/*` names so their internal imports resolve unchanged, and they are wired in as npm workspaces. To retarget a different Minecraft version, replace the `src` folders from an upstream checkout and re-run `npm run build:vendor`.

Everything under `src/` and `app/` is Mistvale's own code.

## License

MIT
