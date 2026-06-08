# Duplex Apartment Data Pack

This folder tracks a public residential BIM sample as the baseline data pack
for a spatial MEP compiler prototype.

## Selected Reference Project

- Project: Duplex Apartment
- Source repository: `buildingsmart-community/Community-Sample-Test-Files`
- Source path: `IFC 2.3.0.1 (IFC 2x3)/Duplex Apartment`
- Upstream URL: https://github.com/buildingsmart-community/Community-Sample-Test-Files/tree/main/IFC%202.3.0.1%20(IFC%202x3)/Duplex%20Apartment
- Upstream commit observed: `7ddf57a201f88a0c213d5322b02ed15e94a60a40`
- License note from upstream README: Creative Commons Attribution 4.0, with attribution to `BSI (2020) "Duplex Apartment Test Files," buildingSMART International`.

## Why This Project

The upstream README describes this as a two-story duplex apartment building.
It includes an architectural model plus discipline-specific models intended to
simulate engineering consultant deliverables on larger projects.

That makes it a useful public baseline for:

- architectural shell and floor/space structure
- room and space schedules
- electrical sample data
- MEP sample data
- plumbing sample data
- COBie design and handover sheets
- product/document references

## Current Local Status

The local `raw/` folder contains the downloadable non-LFS files and Git LFS
pointers for the IFC models.

The true IFC binaries are currently blocked by the upstream repository's GitHub
LFS budget response. The pointer files are kept intentionally because they
record the exact SHA-256 object IDs and expected byte sizes.

Run this to retry downloads:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\download-duplex-apartment.ps1
```

## Data Coverage

Available locally:

- `README.md`
- `2012-03-23-Duplex-Design.xlsx`
- `2012-03-23-Duplex-Handover.xlsx`
- `2020-11-11-DuplexArc.jpg`
- `2020-11-11-DuplexEle.jpg`
- `2020-11-11-DuplexMec.jpg`
- `2020-11-11-DuplexPlu.jpg`
- IFC LFS pointers for Architecture, Electrical, MEP, Rooms/Spaces, Plumbing

Still needed for full extraction:

- true IFC binaries from Git LFS or another public mirror
- optional product PDFs from the upstream `document/` folder
- any native authoring files, if available elsewhere

## Intended Compiler Flow

```text
raw BIM / COBie / views
  -> source inventory
  -> architectural graph
  -> MEP system graph
  -> spatial-meta JSON
  -> Three.js / Unity / Godot adapters
```

