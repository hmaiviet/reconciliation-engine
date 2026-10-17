---
name: recon-gui
description: Builds the small React + TypeScript GUI for the reconciliation engine - CSV file selection, UTC cutoff input, results view, manual pin add/remove with rerun, and report.json/manual.csv exports - plus the single `npm run dev` startup. Use when working on frontend components, UI state, manual pairing UX, exports, or local dev startup.
---

# Recon GUI

## Setup

- Use Vite + React + TypeScript in `web/`, with the Vite dev server proxying `/reconcile` to the API.
- `npm run dev` starts both the API and Vite on loopback. A small Node script that spawns both and kills both on SIGINT is enough. Document the ports and how to shut down (Ctrl+C) in the README.
- The GUI never matches records itself. Every result comes from `POST /reconcile`.

## Screens and state

1. **Inputs:** three file pickers (ours, theirs, optional manual), a cutoff field labeled **UTC**, and a Run button. Read files as text in the browser and send them as strings.
2. **Results:** summary counts, matches grouped by kind (showing amount and time diffs), and unmatched ours and theirs tables with every echoed field.
3. **Manual pairing:** select one unmatched record on each side, then click "Pin". Pins are listed with a remove action. Rerunning sends the pins as generated `manual.csv` text.
4. **Exports:** download `report.json` (the last API response) and `manual.csv` (header `ours_id,theirs_id` plus current pins, so the CLI can reuse them).

State lives in memory only. Show a visible note that pins are lost on reload unless exported.

## UX requirements

- Show a loading state while a run is in flight, and disable Run during it.
- Render API `errors[]` as a list in the form `file:row field: message`.
- Show pin conflicts clearly, for example a record that is already pinned.
- Display decimals as the strings received and never reformat them through `Number`.
- Give interactive elements accessible names or `data-testid`s so Playwright can target them (`getByRole` first).

## Done when

A user can load files, reconcile, inspect unmatched records, pin a pair, rerun, and export, and the exported `manual.csv` reproduces the same report through the CLI.
