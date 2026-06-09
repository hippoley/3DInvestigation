# Duplex Simulation Viewer

Viewer page:

```text
duplex-simulation.html
```

Recommended local URL:

```text
http://127.0.0.1:5174/duplex-simulation.html
```

Start the static server:

```powershell
python -m http.server 5174 --bind 127.0.0.1
```

## What It Does

This is the first 1:1 whole-house restoration simulation page for the Duplex
Apartment sample.

It combines:

- real BIM geometry loaded from XKT
- schema-level data from `spatial-meta/v1`
- object/system counts from IFC and COBie extraction
- layer controls for Architecture and MEP
- camera focus controls
- x-ray and edge display controls

## Geometry Sources

Loaded into the viewer:

- `converted/xeokit/Duplex_A_20110907/model.xkt`
- `converted/xeokit/Duplex_MEP_20110907/model.xkt`

Also available in the data pack, but not yet converted into separate XKT viewer
layers:

- `raw/Duplex_Electrical_20121207.ifc`
- `raw/Duplex_M_20111024_ROOMS_AND_SPACES.ifc`
- `raw/Duplex_Plumbing_20121113.ifc`

Those files are included in `spatial-meta.json` and can be converted in the next
viewer pass.

## Schema Source

The viewer reads:

```text
samples/duplex-apartment/derived/spatial-meta.json
```

Current schema-side counts:

- 16 level records
- 102 space records
- 238 architecture records
- 2980 system records
- 970 ports
- 1455 links
- 232 COBie components
- 36 COBie systems
- 48 COBie documents

## Current Status

This is a BIM-level 1:1 restoration simulation, not a construction-grade private
home as-built reproduction.

It is suitable for:

- whole-house BIM viewing
- architecture/MEP visual validation
- schema-driven system inspection
- front-end adapter experiments

It still needs:

- individual XKT conversion for Electrical, Plumbing, and Rooms/Spaces layers
- room canonicalization across discipline models
- MEP semantic classification
- pipe/duct centerline extraction
- evidence and uncertainty overlays

