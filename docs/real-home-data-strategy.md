# Real Home Data Strategy

For a real residential unit, a complete channel data package usually requires:

1. Architectural base data: floor plan, walls, slabs, doors, windows, levels, room names, dimensions.
2. Structural data: columns, beams, load-bearing walls, slab thickness, openings.
3. Mechanical data: HVAC units, ducts, vents, return air, outdoor air, condensate, refrigerant paths.
4. Fresh-air data: fresh-air unit, supply/exhaust routes, wall penetrations, duct diameter, air volume.
5. Heating data: manifold, hydronic loops, pipe spacing, supply/return direction.
6. Plumbing data: cold water, hot water, drainage, fixtures, risers, slopes, pipe diameters.
7. Electrical data: panels, circuits, switches, receptacles, lighting, low-voltage points.
8. Equipment data: manufacturer model, size, ports, clearances, BIM families or CAD blocks.
9. Site evidence: photos, videos, scan data, redlines, as-built drawings.

The compiler should treat this as a graph, not only as 3D geometry:

```text
space geometry
  + object semantics
  + adjacency topology
  + system connections
  + installation constraints
  -> spatial meta
```

The `samples/duplex-apartment` pack is the current public baseline. It is not a
complete private-home construction package, but it is traceable and close enough
to test the data workflow.

