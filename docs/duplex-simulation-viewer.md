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
- front-end playback data from `spatial-viewer-payload/v1`
- object/system counts from IFC and COBie extraction
- floor layer controls generated from canonical BIM levels
- layer controls for Architecture and MEP
- canonical room and system-category inspection
- searchable object index with focus-on-object support where the XKT layer is loaded
- semantic point overlays for Electrical, Plumbing, HVAC, hydronic, fixture, and
  fire-safety objects that have IFC placement coordinates
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

Until those XKT layers exist, the viewer projects their IFC placement coordinates
as colored semantic points over the 1:1 model. This is useful for checking system
presence and approximate distribution, but it is not a substitute for pipe/duct
centerline geometry or shop-drawing routing.

## Schema Source

The viewer reads:

```text
samples/duplex-apartment/derived/viewer-payload.json
```

Current schema-side counts:

- 4 canonical levels from 16 source level records
- 22 canonical spaces from 102 source space records
- 238 architecture records
- 2980 system records
- 970 ports
- 1455 links
- 232 COBie components
- 36 COBie systems
- 48 COBie documents
- 3218 searchable architecture/system objects
- semantic overlay points are drawn from system objects with usable locations;
  unclassified `*_other` systems are hidden by default and can be inspected by
  selecting their category

## Layering

The viewer supports two layer axes:

- discipline layers: Architecture and MEP XKT geometry can be toggled from the
  bottom toolbar
- floor layers: canonical levels are converted into vertical ranges, then used
  to hide/show XKT objects and semantic overlay points by height

The current floor filter uses each object's XKT AABB center height. This is good
enough for inspection, but construction-grade slicing should eventually use
space containment, level assignment, and dedicated section planes.

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
- richer MEP semantic classification from manufacturer/model naming and COBie systems
- pipe/duct centerline extraction
- evidence and uncertainty overlays
- construction-document overlays for shop drawings, as-built photos, and site changes
