# Real Home Project Template

Copy this folder for each real renovation project.

Recommended layout:

```text
real-home-project/
  manifest.json
  file-inventory.csv
  site-photo-checklist.csv
  raw/
    drawings/
    equipment/
    photos/
    as-built/
  derived/
    spatial-meta.json
    validation/
```

Keep `raw/` immutable. Put parsed or generated outputs in `derived/`.

