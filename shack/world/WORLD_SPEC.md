# The Shack: world spec v2 (floating islands)

The Shack is a living 16-bit pixel world showing a hub-and-spoke team of AI agents working for **Hudson**, a high-school student. It is published as one HTML page (a claude.ai Artifact) and viewed mostly on a **MacBook** (about 1440×800), and must also work on a phone.

**v2 changes everything spatial:** the world is now **five floating islands in starry space**. There are **no real-world places** (no inn, no school building, no Hudson River): the look is fictional, but every number, bubble and growth stage is driven by real data.

Read `src/00-core.js` fully before writing anything. It is the engine and the only shared API. **Do not edit it.** If you need a core change, say so in your final report. Old v1 modules are in `legacy/` (same art style, old coordinates). **Reuse their sprite and drawing code freely**, adapted to the new layout.

## The islands (tile coords; the world is 80×50 tiles of 16 px = 1280×800 native px)

| id | Name | Agent · character | Top rect (x, y, w, h) | Underside depth | Transport to Clockspire |
|---|---|---|---|---|---|
| `square` | **Clockspire** | hub · **Mayor Tock** | 30, 15, 20, 17 | 6 | (the hub: four docks) |
| `monastery` | **Lantern Peak** | academic-core · **Abbot Quill** | 3, 2, 23, 16 | 6 | **paper kites and gliders** |
| `market` | **Neon Hollow** | social-ops · **Lumi** | 54, 2, 23, 16 | 6 | **neon blimp** |
| `port` | **Spindrift Harbor** | hustle-engine · **Cap'n Twirl** | 3, 29, 23, 15 | 5 | **sky-ship** |
| `mine` | **Copperhold** | ledger-fi · **Grit Copperpot** | 54, 29, 23, 15 | 5 | **minecart on a sky-rail bridge** |

- Each island's **walkable top** is drawn with an organic, ragged edge **inside** its top rect (keep about 1 tile of margin for the edge). Below the top's south edge hangs a **rocky underside** `depth` tiles tall that tapers to a point. The underside has **hanging roots and glowing crystals**, lit from the top-left, with darker strata lower down.
- **Waterfalls spill off island edges** into space and fade out as they fall. The port's river pours off its west edge, and every island has at least one small spring or waterfall.
- Islands **bob** a couple of pixels (`S.bob(id)`); the core handles it for static art, `registerDynamic(…, {island})` layers and entities with `.island`.
- `S.islandBox(id)` is the pixel box each island's static art is cut into (2 tiles of margin left and right, 3 above, the underside plus 1 below). **Static art outside every island box is discarded.** Anything spanning space (the sky-rail bridge, ropes, vehicles) is dynamic.
- Hub-and-spoke is physical: biome islands connect **only** to Clockspire, never to each other. `S.route(a, b)` returns legs (`walk` per island, then `kite | blimp | ship | rail`).

### Landmarks (`S.landmarks`) and nav nodes (`S.nav.nodes`)
- Clockspire: `clockTower` (39,19), `fountain` (39,26), `questBoard` (35,22), `mailPost` (43,22), `chronicle` (43,28), the Chronicle lectern where Mayor Tock's recaps live, plus four docks: `dockNW` (31,17) kite landing, `dockNE` (48,17) blimp mast, `dockSW` (31,29) sky-ship pier, `dockSE` (48,29) rail station.
- Lantern Peak: `temple` (13,7), `studyGarden` (19,13), `kitePad` (23,13).
- Neon Hollow: `billboard` (66,4), `broadcastTower` (73,6), `angiesStall` (61,9), `fidgetStall` (69,13) for **Fidgetly**, `blimpMast` (56,13).
- Spindrift Harbor: `bazaar` (13,37), `skyDock` (23,33), `warehouse` (7,41).
- Copperhold: `mineEntrance` (71,32), `vault` (64,41), three **savings crystals** `crystalInvest` (59,39, gold), `crystalCar` (62,39, blue), `crystalHome` (65,39, violet) that grow with each goal's `current / target` from `metrics.savings`, and `railStation` (56,33).
- Paths: every walk edge in `S.nav.edges`, 2 tiles wide (`S.onRoad`).

## Art direction: 16-bit cozy, in space
- Stardew / SNES 3/4 top-down view (roofs **and** front walls). Light from the **top-left**. 1 px dark outlines, at least 3 tones, dithering and `S.hash` noise for texture, never flat blocks.
- Space: deep indigo-to-violet nebula gradients, layered stars, a **ringed planet**, a **moon in the real current phase**, and **shooting stars**. By day (`S.time.light` high) space brightens to a softer blue-violet with a warm sun glow from the top-left. At night it's deep and full of stars.
- Seasons still apply to island foliage (`S.time.season`, autumn now).
- Growth (`S.status[id].growth` 0–3) visibly develops each island. Growth 0 must still look complete and charming.
- Readability first: from the fit view (about zoom 1.1, the whole map visible) each island, its name-defining landmark and its characters must read clearly against space.

## Characters (the villagers module)
- **1.5× the v1 size**: about 18–24 px wide and 27–33 px tall native, original sprites, 4-direction walk cycles.
- **Bouncy walk + footstep dust puffs**, so movement catches the eye.
- **Name tags always on** via `S.label(entity, name, {color: S.AGENTS[agent].color})`.
- Agents commute by their island's transport: Abbot Quill hangs from a **paper kite / glider**, Grit rides a **minecart** along the sky-rail, Lumi rides the **neon blimp**, Cap'n Twirl sails the **sky-ship**. Mayor Tock stays on Clockspire.

## Engine rules (from 00-core.js)
- Native 1280×800. Integer pixels, no anti-aliased shapes; text only through DOM (`S.bubble`, `S.label`, hotspot `label`).
- **Static layers:** order < 0 is space (sky module only). Order ≥ 0 is island art: 0 island bases (islands module), 5 ground overlays per island (monastery 5, mine 6, market 7, port 8), 10 paths (islands module), 15 Clockspire buildings, 20–23 biome buildings (monastery 20, mine 21, market 22, port 23), 50 scattered decor (islands module).
- **Dynamic layers:** < 90 space animation (behind islands), 100 water and ground animation, 200 decor under people, 300 entities, 400 above people, 500 weather, 600 darkness, 700 glow, 800 markers. Use `{island: id}` for island-bound dynamic art.
- `S.reserve(tx, ty, w, h)` at load for solid things. Decor uses `S.isFree()`.
- `S.addLight({x, y, r, color, intensity, flicker, nightOnly, island})`: always pass `island` so the light bobs.
- `S.addHotspot({id: 'landmark:<key>', kind: 'landmark', landmark, biome: <island id>, agent, label, x, y, w, h, priority: 1})`.
- Data: `S.data`, `S.thread(agent)`, `S.metrics(agent)`, `S.status`, `S.time`, `S.cycle`. **Real data only** in the shipped page, with honest empty states. `S.data.sample === true` only in previews.
- IIFE + `'use strict'`; only `window.SHACK`; respect `S.reducedMotion`; zero console errors.

## Fonts and UI
- Clean, highly readable UI font: **Atkinson Hyperlegible** (Google Fonts) for all panels, numbers, bubbles and name tags. **Pixelify Sans** only for big titles (THE SHACK, island names in panel headers).
- Larger base sizes (body 15–16 px, labels never under 12 px), high contrast.

## Testing
```
node shack/world/tools/preview.mjs --out /tmp/<you>-1.png --sample --zoom 3 --center <tx>,<ty>
node shack/world/tools/preview.mjs --out /tmp/<you>-2.png --sample --time 2026-10-09T21:30:00-04:00
node shack/world/tools/preview.mjs --out /tmp/<you>-3.png --sample --season winter
node shack/world/tools/preview.mjs --out /tmp/<you>-4.png                       # real (mostly empty) data
node shack/world/tools/preview.mjs --out /tmp/<you>-5.png --sample --only 05-space.js,10-islands.js,<yours>.js
```
Look at every screenshot with the Read tool. Zero errors or warnings from your module. Other builders work in parallel, so use `--only` to isolate. Screenshots go in `/tmp/` only.
