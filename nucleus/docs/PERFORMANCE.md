# NUCLEUS performance

These are measured numbers, not targets. Each row records how it was measured.

## How to run

```
npx vitest run --config vitest.perf.config.ts
```

This writes `tests/perf/results.json`. The benchmark (`tests/perf/bench.perf.ts`) builds resistor ladders with `tests/perf/fixtures.ts`:
- V1 → R1 → … → RN → GND, with nets by label;
- N = 100, 500 and 2 000 parts;
- the real engine code is called; nothing is mocked.

On the PCB side:
- each part is placed on a 5 mm grid;
- the "dense" board draws every connection as a top segment, a via and a bottom segment;
- at 2 000 parts that is **9 997 copper objects**: 4 000 pads, 3 998 tracks and 1 999 vias.

## Environment (2026-11-12)
- Cloud container: Intel Xeon (model not reported), 4 cores, 15 GB RAM, Linux.
- Node 22.23.4, single thread.
- No GPU, so canvas frame rates are **not** measured here.
- Times are the mean of 1–10 repetitions, as set per operation in the script.

## Results (milliseconds unless stated)

| Operation | 100 parts | 500 parts | 2 000 parts |
|---|---|---|---|
| Connectivity (nets from geometry) | 6.1 | 27.2 | 268 |
| ERC | 2.6 | 28.8 | 423 |
| SPICE netlist | 1.9 | 4.0 | 12.9 |
| Save (canonical JSON + SHA-256) | 2.8 | 5.0 | 17.4 |
| File size | 58 KB | 285 KB | 1 142 KB |
| Open (parse, validate, checksum) | 3.6 | 5.0 | 18.4 |
| Move one part (with rubber-band wires) | 0.04 | 0.1 | 0.1 |
| ngspice operating point | 357 (includes WASM start-up) | 6.8 | 22.0 |
| Schematic → PCB sync | 0.6 | 3.1 | 23.1 |
| Ratsnest | 6.2 | 31.2 | 322 |
| DRC, placed board (unrouted) | 13.2 | 41.8 | 355 |
| DRC, dense board | 22.4 | 79.5 | **697** |
| Copper objects (dense board) | 497 | 2 497 | 9 997 |

The script also prints a heap delta. It is not reported here because garbage collection makes it unreliable; it was negative at 100 parts.

## Change made this cycle: DRC spatial index
Before this cycle, DRC compared every pair of copper objects, plus every pair of courtyards and every track end against every object.

| | 100 | 500 | 2 000 parts |
|---|---|---|---|
| Dense-board DRC before | 92 ms | 691 ms | **10 295 ms** |
| Dense-board DRC after (`BoxGrid` uniform grid) | 22 ms | 80 ms | **697 ms** (14.8× faster) |

The findings are unchanged. `tests/drc-index.test.ts` runs grid and brute-force DRC on the same boards and requires identical findings, in the same order.

## Known hot spots (next)
At 2 000 parts these are now the slowest steps:
- **ERC: 0.42 s.**
- **Ratsnest: 0.32 s.**
- **Connectivity: 0.27 s.**

Each grows faster than linearly. They run after edits, so at this size an edit costs about 1 s of recomputation. The next step is incremental connectivity: recompute only the nets an edit touches.

## Not measured yet
- Canvas frame rate and interaction latency on a real display.
- Autorouter time on large boards.
- Transient simulation time on large circuits.
- Windows desktop start-up time.
