# Duplex Apartment Restoration Audit

## Verdict

The current data pack can support a real structured restoration workflow.

It is strong enough for:

- architectural shell reconstruction
- room/floor/space hierarchy extraction
- door/window/slab/stair reconstruction
- MEP/plumbing/electrical object extraction
- product/document reference binding
- viewer-ready 3D reconstruction from IFC geometry
- spatial-meta generation for web/Unity/Godot adapters

It is not enough for a construction-grade private-home reproduction without
additional shop drawings, manufacturer-specific installation details, site
photos, and local code/design assumptions.

## Source Files

All five IFC files are present and SHA-256 verified against the upstream Git LFS
object IDs.

| File | Role | Size |
|---|---:|---:|
| `Duplex_A_20110907.ifc` | Architecture | 2,380,763 |
| `Duplex_Electrical_20121207.ifc` | Electrical | 1,602,758 |
| `Duplex_MEP_20110907.ifc` | MEP | 17,871,432 |
| `Duplex_M_20111024_ROOMS_AND_SPACES.ifc` | Rooms / Spaces | 8,781,887 |
| `Duplex_Plumbing_20121113.ifc` | Plumbing | 31,556,138 |

## IFC Entity Evidence

Key extracted counts:

| File | Spaces | Products | Important Evidence |
|---|---:|---:|---|
| Architecture | 21 | 295 | 56 wall standard cases, 14 doors, 24 windows, 21 slabs, 2 stairs |
| Electrical | 1 | 109 | 82 flow terminals |
| MEP | 42 | 973 | 427 flow segments, 358 fittings, 105 terminals |
| Rooms / Spaces | 37 | 529 | 246 flow segments, 207 fittings |
| Plumbing | 1 | 1474 | 231 flow segments, 227 fittings, 16 terminals, 970 distribution ports |

COBie files are also available:

| File | Facility | Floors | Spaces | Types | Components | Systems | Coordinates | Documents |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `2012-03-23-Duplex-Design.xlsx` | 1 | 4 | 22 | 43 | 232 | 36 | 42 | 0 |
| `2012-03-23-Duplex-Handover.xlsx` | 1 | 4 | 22 | 43 | 232 | 36 | 42 | 48 |

## What Can Be Restored

### High Confidence

- building hierarchy: project, site, building, storeys
- room/space objects and names
- architectural geometry: walls, doors, windows, slabs, roof, stairs
- product-level references from COBie
- basic furniture/sanitary/equipment objects when present in IFC
- MEP/plumbing/electrical object positions and shapes
- plumbing topology using `IfcDistributionPort`, `IfcRelConnectsPortToElement`,
  and `IfcRelConnectsPorts`

### Medium Confidence

- exact system classification across all MEP components
- semantic mapping from generic IFC flow segments/fittings to domain terms such as
  fresh air, supply air, hot water, drainage, or condensate
- generated pipe/duct centerlines where geometry is mesh-heavy
- room-to-system assignment where spaces differ across discipline files

### Low Confidence / Missing

- real residential construction drawings beyond the public BIM sample
- HVAC shop drawings and installer's final routing decisions
- hydronic floor heating design
- manufacturer-specific VRF indoor-unit models like Toshiba `MMD-UP0121SPHY-E`
- site photos, hidden-work photos, as-built redlines
- local material/finish specification for photoreal rendering

## Practical Restoration Levels

### Level 1: Viewer Restoration

Load IFC or converted XKT and display the project.

Status: achievable now.

### Level 2: Semantic Spatial Meta

Compile IFC + COBie into `spatial-meta/v1`:

```text
storeys
rooms
walls/slabs/doors/windows
MEP components
flow segments/fittings/terminals
ports and connections
documents
```

Status: achievable now.

### Level 3: Residential Comfort-System Demo

Adapt the sample into a home systems demo with HVAC, fresh air, plumbing, and
electrical visibility toggles.

Status: achievable, but some classification needs mapping rules and manual
review.

### Level 4: Construction-Grade Reproduction

Use the model as a施工依据-grade full reconstruction.

Status: not achievable from this public sample alone. It requires CAD/shop
drawings, site conditions, installation details, equipment selections, and
as-built verification.

## Recommended Next Step

Build a compiler script:

```text
IFC files + COBie spreadsheets
  -> entity inventory
  -> stable object IDs
  -> spatial-meta JSON
  -> Three.js adapter
  -> validation screenshots
```

The first extraction target should be:

- storeys
- spaces
- architectural elements
- flow segments
- flow fittings
- flow terminals
- distribution ports
- COBie components/systems/documents

