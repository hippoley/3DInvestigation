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
| Architecture records | 237 |
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

## Current Limits

This first compiler pass does not yet export:

- triangle meshes
- pipe or duct centerlines
- simplified collision geometry
- canonical merged room graph
- semantic labels such as `fresh_air_supply`, `hot_water`, `drainage`, or
  `refrigerant`
- evidence confidence scores

It does extract enough object identity, class, placement, source, type name, and
connection data to build those layers next.

## Next Compiler Pass

Recommended next steps:

1. Canonicalize levels and rooms across discipline files.
2. Add MEP classification rules from type names, IFC classes, and COBie systems.
3. Extract path-like geometry for `IfcFlowSegment`.
4. Bind COBie components/systems/documents to IFC object IDs.
5. Generate a smaller front-end payload for Three.js.

