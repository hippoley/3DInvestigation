# Real Home Data Acquisition

This guide defines what must be collected to turn a real home renovation project
into a construction-grade spatial data pack.

## Goal

Collect enough evidence to produce:

```text
real project documents
  -> verified file inventory
  -> architectural / MEP / site evidence graph
  -> spatial-meta JSON
  -> interactive 3D restoration
```

The key is not one perfect drawing. The key is traceability across design,
deepening, installation, hidden work, and as-built handover.

## Stakeholders

| Data owner | What to request |
|---|---|
| Owner / property manager | original floor plan, developer handover drawings, property constraints |
| Interior designer | renovation construction drawings, ceiling, lighting, elevations, details |
| HVAC contractor | air conditioning, fresh air, refrigerant, condensate, vents, equipment list |
| Floor-heating contractor | manifold, loop layout, pipe spacing, supply/return direction |
| Plumbing contractor | cold/hot water, drainage, risers, fixture points, slope notes |
| Electrician / smart-home vendor | strong/weak current, panel circuits, controls, sensors |
| Equipment vendor | manuals, product specs, CAD blocks, Revit families, clearance rules |
| Site supervisor / owner | photos, videos, change orders, hidden-work records, acceptance sheets |

## Minimum Viable Package

For a first real project, collect at least:

1. original floor plan or architectural CAD
2. interior renovation drawings
3. ceiling drawing
4. electrical / switch / socket drawing
5. water and drainage drawing
6. HVAC / fresh-air / VRF drawing
7. floor-heating drawing
8. equipment schedule
9. hidden-work photos before closing walls and ceiling
10. as-built drawing or change record

This is enough for a believable spatial restoration. It is not yet enough for
legal construction verification unless signed and issued-for-construction.

## Full Data Checklist

### Architecture and Interior

- original developer floor plan
- measured floor plan
- wall demolition / new wall drawing
- floor finish drawing
- ceiling / soffit drawing
- lighting layout
- switch layout
- socket layout
- interior elevations
- cabinet / custom furniture drawings
- material schedule
- door and window schedule
- detail drawings and section details

### Structure and Constraints

- load-bearing wall map
- beam / column / slab data
- existing openings
- allowed core drilling positions
- property / building management restrictions
- ceiling height and usable plenum height

### HVAC / VRF / Fresh Air

- indoor unit positions
- outdoor unit position
- supply air vent positions
- return air vent positions
- fresh air vent positions
- exhaust vent positions
- duct routes
- refrigerant pipe routes
- condensate pipe routes
- wall / beam penetration positions
- equipment model numbers
- duct sizes, pipe diameters, air volume, static pressure
- installation heights and access panel positions

### Floor Heating / Hydronic

- manifold position
- loop layout
- pipe spacing
- pipe diameter
- each loop to room mapping
- supply / return direction
- thermostat locations
- floor build-up thickness
- pressure-test record

### Plumbing

- cold water routes
- hot water routes
- drainage routes
- riser locations
- kitchen fixture points
- bathroom fixture points
- balcony / laundry fixture points
- pipe diameters
- drainage slopes
- floor drain positions
- water heater / pump / valve positions

### Electrical / Controls

- distribution panel
- circuit schedule
- lighting circuits
- socket circuits
- HVAC controls
- fresh-air controls
- floor-heating thermostat wiring
- weak current / network points
- smart-home devices
- sensors, smoke detector, leak detector

### Equipment and Product Data

- brand
- model
- dimensions
- installation manual
- product datasheet
- CAD block
- BIM family / IFC asset
- interface positions
- maintenance clearance
- warranty / acceptance documents

### Site Evidence

- empty-site photos
- demolition photos
- wall chasing photos
- pipe installation photos
- duct installation photos
- refrigerant / condensate photos
- manifold and floor-heating photos
- pressure-test photos
- ceiling-before-close photos
- cabinet-before-close photos
- final as-built photos
- marked-up change photos

## Evidence Stages

| Stage | Required evidence |
|---|---|
| S0 existing site | measured plan, site photos, original constraints |
| S1 design | construction drawings, equipment schedule |
| S2 deepening | HVAC / plumbing / electrical routes and heights |
| S3 rough-in | photos before concealment, pressure tests, labels |
| S4 closing | ceiling/wall closing photos, access panel check |
| S5 handover | as-built drawings, change orders, acceptance records |

## File Naming

Use stable names:

```text
project-code/category/stage/file
```

Examples:

```text
RH-001/drawings/S1_design/floor-plan.dwg
RH-001/drawings/S2_deepening/hvac-vrf-routing.dwg
RH-001/photos/S3_rough-in/hvac-ceiling-living-001.jpg
RH-001/equipment/vrf/toshiba-mmd-up0121sphy-e-datasheet.pdf
```

## Quality Rules

- Every drawing must have source, date, version, and author if known.
- Every photo must have room, stage, direction, and what it proves.
- Every equipment item must have model, dimensions, and interface positions.
- Every route must have path, height, diameter/size, and system meaning.
- Every field change must be recorded instead of silently overwriting drawings.

## Spatial Meta Extraction Targets

After collecting data, extract:

- rooms and polygons
- walls, doors, windows, slabs
- ceiling heights and soffit zones
- devices and equipment
- vents, manifolds, panels, fixtures
- pipe / duct / cable paths
- system connections
- site evidence references
- uncertainty notes

## Acquisition Script for Partners

Use this message with a contractor:

> We are creating a 3D visual handover and hidden-work archive for one sample
> home project. Please provide the latest CAD/PDF drawings, equipment schedule,
> product manuals, and stage photos before walls or ceilings are closed. We will
> label every file by source and keep changes visible instead of altering your
> construction documents.

