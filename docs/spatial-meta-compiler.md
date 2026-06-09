# Spatial Meta Compiler

This project now includes a first-pass compiler:

```text
IFC + COBie
  -> spatial-meta/v1
```

Script:

```powershell
python scripts\compile_duplex_spatial_meta.py
```

Outputs:

- `samples/duplex-apartment/derived/spatial-meta.json`
- `samples/duplex-apartment/derived/extraction-summary.json`
- `samples/duplex-apartment/derived/viewer-payload.json`

## What It Extracts

From IFC:

- source IFC files
- storeys / levels
- spaces
- architecture buckets:
  - walls
  - slabs
  - doors
  - windows
  - stairs
  - roof
  - beams
  - openings
  - furnishings
- MEP/electrical/plumbing buckets:
  - flow segments
  - fittings
  - terminals
  - controllers
  - moving devices
  - storage/treatment/conversion devices
  - distribution elements
  - distribution ports
- port-to-element relationships
- port-to-port relationships

From COBie:

- facility
- floors
- spaces
- types
- components
- systems
- coordinates
- documents

## Current Output Counts

Latest extraction:

| Item | Count |
|---|---:|
| Source IFC files | 5 |
| Level records | 16 |
| Space records | 102 |
| Architecture records | 238 |
| Electrical system records | 99 |
| MEP system records | 926 |
| Rooms/Spaces MEP records | 487 |
| Plumbing records | 1468 |
| Distribution ports | 970 |
| Port-to-element links | 970 |
| Port-to-port links | 485 |

COBie:

| Sheet group | Design | Handover |
|---|---:|---:|
| Facility | 1 | 1 |
| Floors | 4 | 4 |
| Spaces | 22 | 22 |
| Types | 43 | 43 |
| Components | 232 | 232 |
| Systems | 36 | 36 |
| Coordinates | 42 | 42 |
| Documents | 0 | 48 |

## Why Level and Space Counts Are Higher Than the Architecture Model

The compiler keeps records source-tagged per discipline file instead of merging
them immediately.

That means `Level 1` from Architecture and `Level 1` from MEP are separate
records at this stage. This preserves evidence and avoids accidental cross-file
merges. A later normalization pass should create canonical levels/spaces and
map each discipline-specific space to the canonical room.

## Viewer Payload

The compiler also emits `spatial-viewer-payload/v1` for front-end playback:

- canonical levels: 4
- canonical spaces: 22
- architecture records: 238
- system records: 2980
- system categories: HVAC air, hydronic heat, cold water, hot water, drainage,
  electrical power, fixtures, fire safety, and unclassified MEP/plumbing
- searchable object index: 3218 architecture and system objects

This file is intentionally smaller and easier for a renderer to consume than the
full `spatial-meta.json`. The full meta file remains the source of truth for
evidence, source discipline records, ports, links, COBie, and uncertainty notes.

## Current Limits

This first compiler pass does not yet export:

- triangle meshes
- pipe or duct centerlines
- simplified collision geometry
- construction-grade pipe/duct routing geometry
- full COBie-to-IFC binding for every object
- evidence confidence scores

It does extract enough object identity, class, placement, source, type name, and
connection data to build those layers next.

## Next Compiler Pass

Recommended next steps:

1. Convert Electrical, Plumbing, and Rooms/Spaces IFC files into viewer layers.
2. Extract path-like geometry for `IfcFlowSegment`.
3. Bind COBie components/systems/documents to IFC object IDs.
4. Add evidence confidence scores per object and route.
5. Generate downstream builders for Three.js, Unity, Godot, and OpenUSD.
