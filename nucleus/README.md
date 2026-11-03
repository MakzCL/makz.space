# NUCLEUS

Electronics design, simulation and PCB engineering suite. **Milestone 1:** schematic capture, ERC and SPICE simulation (ngspice) with instruments.

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # core + simulation tests (known values, native ngspice cross-check when installed)
npm run build && npx vite preview --port 4280 &
node tests/e2e/beta.mjs           # first-beta acceptance steps 1–12 in Chromium
```

No internet connection is needed: the simulator runs locally in WebAssembly. Documentation is in `docs/`. The status of every feature is in `docs/feature-parity-matrix.md`.
