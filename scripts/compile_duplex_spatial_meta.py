from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import ifcopenshell
from ifcopenshell.util.element import get_predefined_type, get_psets, get_type
from ifcopenshell.util.placement import get_local_placement
import openpyxl


SAMPLE_ID = "duplex-apartment"

IFC_FILES = {
    "architecture": "Duplex_A_20110907.ifc",
    "electrical": "Duplex_Electrical_20121207.ifc",
    "mep": "Duplex_MEP_20110907.ifc",
    "rooms_spaces": "Duplex_M_20111024_ROOMS_AND_SPACES.ifc",
    "plumbing": "Duplex_Plumbing_20121113.ifc",
}

ARCHITECTURE_CLASSES = [
    "IfcWall",
    "IfcWallStandardCase",
    "IfcSlab",
    "IfcDoor",
    "IfcWindow",
    "IfcStair",
    "IfcRoof",
    "IfcColumn",
    "IfcBeam",
    "IfcOpeningElement",
    "IfcFurnishingElement",
]

MEP_CLASSES = [
    "IfcFlowSegment",
    "IfcFlowFitting",
    "IfcFlowTerminal",
    "IfcFlowController",
    "IfcFlowMovingDevice",
    "IfcFlowStorageDevice",
    "IfcFlowTreatmentDevice",
    "IfcEnergyConversionDevice",
    "IfcDistributionElement",
    "IfcDistributionControlElement",
    "IfcDistributionPort",
]

SYSTEM_KEYWORDS = [
    ("plumbing_drainage", ["drain", "waste", "sewer", "siphonic"]),
    ("plumbing_hot_water", ["hot water", "domestic hot", "heater"]),
    ("plumbing_cold_water", ["cold water", "domestic cold", "water"]),
    ("hvac_air", ["duct", "air", "supply", "return", "exhaust", "diffuser", "fan"]),
    ("hydronic_heat", ["radiator", "hydronic", "heating", "pump"]),
    ("electrical_power", ["receptacle", "outlet", "panel", "switch", "electrical", "power"]),
    ("fire_safety", ["smoke", "fire", "alarm"]),
    ("fixture", ["toilet", "lavatory", "shower", "bathtub", "sink", "basin"]),
]


def safe_name(entity: Any) -> str | None:
    value = getattr(entity, "Name", None)
    return str(value) if value not in (None, "") else None


def safe_description(entity: Any) -> str | None:
    value = getattr(entity, "Description", None)
    return str(value) if value not in (None, "") else None


def safe_global_id(entity: Any) -> str | None:
    value = getattr(entity, "GlobalId", None)
    return str(value) if value not in (None, "") else None


def normalize_label(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"-(m|p|e)$", "", text)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "unnamed"


def get_location(entity: Any) -> list[float] | None:
    placement = getattr(entity, "ObjectPlacement", None)
    if not placement:
        return None
    try:
        matrix = get_local_placement(placement)
        return [round(float(matrix[0][3]), 6), round(float(matrix[1][3]), 6), round(float(matrix[2][3]), 6)]
    except Exception:
        return None


def pset_value(entity: Any, *keys: str) -> Any:
    try:
        psets = get_psets(entity)
    except Exception:
        return None
    for pset in psets.values():
        if not isinstance(pset, dict):
            continue
        for key in keys:
            if key in pset and pset[key] not in (None, ""):
                return pset[key]
    return None


def type_info(entity: Any) -> dict[str, Any]:
    info: dict[str, Any] = {}
    try:
        type_entity = get_type(entity)
    except Exception:
        type_entity = None
    if type_entity:
        info["typeGlobalId"] = safe_global_id(type_entity)
        info["typeName"] = safe_name(type_entity)
        info["typeClass"] = type_entity.is_a()
    try:
        predefined = get_predefined_type(entity)
    except Exception:
        predefined = None
    if predefined:
        info["predefinedType"] = str(predefined)
    return info


def base_object(entity: Any, source: str) -> dict[str, Any]:
    data = {
        "id": safe_global_id(entity) or f"{source}:{entity.id()}",
        "ifcId": entity.id(),
        "ifcClass": entity.is_a(),
        "source": source,
    }
    name = safe_name(entity)
    if name:
        data["name"] = name
    description = safe_description(entity)
    if description:
        data["description"] = description
    location = get_location(entity)
    if location:
        data["location"] = location
    data.update(type_info(entity))
    return data


def classify_system(item: dict[str, Any]) -> str:
    haystack = " ".join(
        str(item.get(key, ""))
        for key in ["name", "description", "typeName", "predefinedType", "ifcClass", "source"]
    ).lower()
    for label, keywords in SYSTEM_KEYWORDS:
        if any(keyword in haystack for keyword in keywords):
            return label
    source = item.get("source")
    if source == "electrical":
        return "electrical_other"
    if source == "plumbing":
        return "plumbing_other"
    if source in ("mep", "rooms_spaces"):
        return "mep_other"
    return "unclassified"


def containment_map(model: Any) -> dict[str, dict[str, Any]]:
    contained: dict[str, dict[str, Any]] = {}
    for rel in model.by_type("IfcRelContainedInSpatialStructure"):
        parent = getattr(rel, "RelatingStructure", None)
        if not parent:
            continue
        parent_data = {
            "spatialId": safe_global_id(parent),
            "spatialName": safe_name(parent),
            "spatialClass": parent.is_a(),
        }
        for child in getattr(rel, "RelatedElements", []) or []:
            gid = safe_global_id(child)
            if gid:
                contained[gid] = parent_data
    return contained


def extract_storeys(model: Any, source: str) -> list[dict[str, Any]]:
    storeys = []
    for storey in model.by_type("IfcBuildingStorey"):
        item = base_object(storey, source)
        elevation = getattr(storey, "Elevation", None)
        if elevation is not None:
            item["elevation"] = float(elevation)
        storeys.append(item)
    return storeys


def extract_spaces(model: Any, source: str, contained: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    spaces = []
    for space in model.by_type("IfcSpace"):
        item = base_object(space, source)
        gid = item["id"]
        if gid in contained:
            item["containedIn"] = contained[gid]
        long_name = getattr(space, "LongName", None)
        if long_name:
            item["longName"] = str(long_name)
        area = pset_value(space, "GrossFloorArea", "NetFloorArea", "Area")
        if area is not None:
            item["area"] = area
        spaces.append(item)
    return spaces


def extract_products(model: Any, source: str, classes: list[str], contained: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    products: list[dict[str, Any]] = []
    seen: set[str] = set()
    for ifc_class in classes:
        for entity in model.by_type(ifc_class):
            gid = safe_global_id(entity) or f"{source}:{entity.id()}"
            if gid in seen:
                continue
            seen.add(gid)
            item = base_object(entity, source)
            if item["id"] in contained:
                item["containedIn"] = contained[item["id"]]
            products.append(item)
    return products


def extract_port_connections(model: Any, source: str) -> dict[str, Any]:
    ports = []
    element_links = []
    port_links = []

    for port in model.by_type("IfcDistributionPort"):
        item = base_object(port, source)
        ports.append(item)

    for rel in model.by_type("IfcRelConnectsPortToElement"):
        port = getattr(rel, "RelatingPort", None)
        element = getattr(rel, "RelatedElement", None)
        element_links.append(
            {
                "id": safe_global_id(rel) or f"{source}:{rel.id()}",
                "source": source,
                "portId": safe_global_id(port) if port else None,
                "elementId": safe_global_id(element) if element else None,
                "elementClass": element.is_a() if element else None,
            }
        )

    for rel in model.by_type("IfcRelConnectsPorts"):
        a = getattr(rel, "RelatingPort", None)
        b = getattr(rel, "RelatedPort", None)
        port_links.append(
            {
                "id": safe_global_id(rel) or f"{source}:{rel.id()}",
                "source": source,
                "fromPortId": safe_global_id(a) if a else None,
                "toPortId": safe_global_id(b) if b else None,
            }
        )

    return {
        "ports": ports,
        "portToElement": element_links,
        "portToPort": port_links,
    }


def read_cobie_table(path: Path, sheet_name: str, max_rows: int | None = None) -> list[dict[str, Any]]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet_name]
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    header = [str(h).strip() if h is not None else f"column_{i}" for i, h in enumerate(rows[0])]
    records = []
    for row in rows[1:]:
        if not any(value is not None for value in row):
            continue
        record = {}
        for key, value in zip(header, row):
            if value is not None:
                record[key] = value
        records.append(record)
        if max_rows and len(records) >= max_rows:
            break
    return records


def extract_cobie(raw_dir: Path) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for name in ["2012-03-23-Duplex-Design.xlsx", "2012-03-23-Duplex-Handover.xlsx"]:
        path = raw_dir / name
        result[name] = {
            "facility": read_cobie_table(path, "Facility"),
            "floors": read_cobie_table(path, "Floor"),
            "spaces": read_cobie_table(path, "Space"),
            "types": read_cobie_table(path, "Type"),
            "components": read_cobie_table(path, "Component"),
            "systems": read_cobie_table(path, "System"),
            "coordinates": read_cobie_table(path, "Coordinate"),
            "documents": read_cobie_table(path, "Document"),
        }
    return result


def summarize_ifc(model: Any) -> dict[str, Any]:
    counts = Counter(entity.is_a() for entity in model)
    return {
        "entityTypes": len(counts),
        "topEntityTypes": counts.most_common(30),
        "keyCounts": {
            "IfcProject": len(model.by_type("IfcProject")),
            "IfcSite": len(model.by_type("IfcSite")),
            "IfcBuilding": len(model.by_type("IfcBuilding")),
            "IfcBuildingStorey": len(model.by_type("IfcBuildingStorey")),
            "IfcSpace": len(model.by_type("IfcSpace")),
            "IfcProduct": len(model.by_type("IfcProduct")),
            "IfcFlowSegment": len(model.by_type("IfcFlowSegment")),
            "IfcFlowFitting": len(model.by_type("IfcFlowFitting")),
            "IfcFlowTerminal": len(model.by_type("IfcFlowTerminal")),
            "IfcDistributionPort": len(model.by_type("IfcDistributionPort")),
        },
    }


def canonicalize_levels(levels: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for level in levels:
        key = normalize_label(level.get("name") or level.get("elevation") or level.get("id"))
        item = grouped.setdefault(
            key,
            {
                "id": f"level:{key}",
                "name": level.get("name") or key,
                "elevation": level.get("elevation"),
                "sourceRefs": [],
            },
        )
        item["sourceRefs"].append({"source": level.get("source"), "id": level.get("id")})
        if item.get("elevation") is None and level.get("elevation") is not None:
            item["elevation"] = level.get("elevation")
    return sorted(grouped.values(), key=lambda item: (item.get("elevation") is None, item.get("elevation") or 0, item["name"]))


def canonicalize_spaces(spaces: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for space in spaces:
        base_name = space.get("name") or space.get("longName") or space.get("id")
        key = normalize_label(base_name)
        item = grouped.setdefault(
            key,
            {
                "id": f"space:{key}",
                "name": base_name,
                "longName": space.get("longName"),
                "area": space.get("area"),
                "sourceRefs": [],
                "locations": [],
            },
        )
        item["sourceRefs"].append({"source": space.get("source"), "id": space.get("id")})
        if space.get("location"):
            item["locations"].append(space["location"])
        if item.get("area") is None and space.get("area") is not None:
            item["area"] = space.get("area")
    return sorted(grouped.values(), key=lambda item: item["id"])


def build_system_classification(systems: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for source, items in systems.items():
        for item in items:
            category = classify_system(item)
            item["systemCategory"] = category
            buckets[category].append(
                {
                    "id": item.get("id"),
                    "source": source,
                    "ifcClass": item.get("ifcClass"),
                    "name": item.get("name"),
                    "typeName": item.get("typeName"),
                    "location": item.get("location"),
                }
            )
    return {
        "counts": {key: len(value) for key, value in sorted(buckets.items())},
        "samples": {key: value[:25] for key, value in sorted(buckets.items())},
    }


def build_viewer_payload(spatial_meta: dict[str, Any]) -> dict[str, Any]:
    canonical_levels = canonicalize_levels(spatial_meta["levels"])
    canonical_spaces = canonicalize_spaces(spatial_meta["spaces"])
    architecture_counts = {key: len(value) for key, value in sorted(spatial_meta["architecture"].items())}
    system_counts = {key: len(value) for key, value in sorted(spatial_meta["systems"].items())}
    system_classification = build_system_classification(spatial_meta["systems"])

    object_index = []
    for bucket, items in spatial_meta["architecture"].items():
        for item in items[:1000]:
            object_index.append(
                {
                    "id": item.get("id"),
                    "domain": "architecture",
                    "bucket": bucket,
                    "ifcClass": item.get("ifcClass"),
                    "name": item.get("name"),
                    "source": item.get("source"),
                    "location": item.get("location"),
                }
            )
    for source, items in spatial_meta["systems"].items():
        for item in items[:1500]:
            object_index.append(
                {
                    "id": item.get("id"),
                    "domain": "systems",
                    "bucket": item.get("systemCategory") or classify_system(item),
                    "ifcClass": item.get("ifcClass"),
                    "name": item.get("name"),
                    "source": source,
                    "location": item.get("location"),
                }
            )

    cobie_handover = spatial_meta["cobie"]["2012-03-23-Duplex-Handover.xlsx"]
    return {
        "schema": "spatial-viewer-payload/v1",
        "sourceProject": spatial_meta["sourceProject"],
        "canonicalLevels": canonical_levels,
        "canonicalSpaces": canonical_spaces,
        "counts": {
            "sourceLevels": len(spatial_meta["levels"]),
            "sourceSpaces": len(spatial_meta["spaces"]),
            "canonicalLevels": len(canonical_levels),
            "canonicalSpaces": len(canonical_spaces),
            "architecture": sum(architecture_counts.values()),
            "systems": sum(system_counts.values()),
            "ports": len(spatial_meta["connections"]["ports"]),
            "links": len(spatial_meta["connections"]["portToElement"]) + len(spatial_meta["connections"]["portToPort"]),
            "cobieComponents": len(cobie_handover["components"]),
            "cobieSystems": len(cobie_handover["systems"]),
            "documents": len(cobie_handover["documents"]),
        },
        "architectureCounts": architecture_counts,
        "sourceSystemCounts": system_counts,
        "systemClassification": system_classification,
        "objectIndex": object_index,
        "uncertainties": spatial_meta["uncertainties"],
    }


def compile_sample(sample_dir: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    raw_dir = sample_dir / "raw"
    derived_dir = sample_dir / "derived"
    derived_dir.mkdir(parents=True, exist_ok=True)

    spatial_meta: dict[str, Any] = {
        "schema": "spatial-meta/v1",
        "sourceProject": SAMPLE_ID,
        "units": "ifc-project-units",
        "coordinateSystem": "IFC_LOCAL_PLACEMENT",
        "evidence": {
            "ifcFiles": [],
            "cobieFiles": [
                "2012-03-23-Duplex-Design.xlsx",
                "2012-03-23-Duplex-Handover.xlsx",
            ],
            "productDocumentsPath": "raw/document",
        },
        "levels": [],
        "spaces": [],
        "architecture": defaultdict(list),
        "systems": defaultdict(list),
        "connections": {
            "ports": [],
            "portToElement": [],
            "portToPort": [],
        },
        "cobie": {},
        "uncertainties": [
            "Geometry meshes and exact pipe/duct centerlines are not exported in this first compiler pass.",
            "MEP semantic classification is currently based on IFC class, type name, and source discipline only.",
            "Construction-grade routing still requires shop drawings, as-built photos, and local installation rules.",
        ],
    }

    summary: dict[str, Any] = {"sourceProject": SAMPLE_ID, "ifc": {}, "cobie": {}}

    for source, file_name in IFC_FILES.items():
        path = raw_dir / file_name
        model = ifcopenshell.open(str(path))
        contained = containment_map(model)
        spatial_meta["evidence"]["ifcFiles"].append(file_name)
        summary["ifc"][file_name] = summarize_ifc(model)

        spatial_meta["levels"].extend(extract_storeys(model, source))
        spatial_meta["spaces"].extend(extract_spaces(model, source, contained))

        if source == "architecture":
            products = extract_products(model, source, ARCHITECTURE_CLASSES, contained)
            for item in products:
                bucket = item["ifcClass"].replace("Ifc", "")
                spatial_meta["architecture"][bucket].append(item)
        else:
            products = extract_products(model, source, MEP_CLASSES, contained)
            for item in products:
                bucket = item["ifcClass"].replace("Ifc", "")
                item["systemHint"] = source
                spatial_meta["systems"][source].append(item)
            connections = extract_port_connections(model, source)
            spatial_meta["connections"]["ports"].extend(connections["ports"])
            spatial_meta["connections"]["portToElement"].extend(connections["portToElement"])
            spatial_meta["connections"]["portToPort"].extend(connections["portToPort"])

    cobie = extract_cobie(raw_dir)
    spatial_meta["cobie"] = cobie
    for file_name, tables in cobie.items():
        summary["cobie"][file_name] = {table: len(rows) for table, rows in tables.items()}

    spatial_meta["architecture"] = dict(spatial_meta["architecture"])
    spatial_meta["systems"] = dict(spatial_meta["systems"])

    return spatial_meta, summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Compile Duplex Apartment IFC/COBie into spatial-meta JSON.")
    parser.add_argument("--sample-dir", default="samples/duplex-apartment", type=Path)
    parser.add_argument("--output", default=None, type=Path)
    parser.add_argument("--summary-output", default=None, type=Path)
    parser.add_argument("--viewer-output", default=None, type=Path)
    args = parser.parse_args()

    sample_dir = args.sample_dir
    output = args.output or sample_dir / "derived" / "spatial-meta.json"
    summary_output = args.summary_output or sample_dir / "derived" / "extraction-summary.json"
    viewer_output = args.viewer_output or sample_dir / "derived" / "viewer-payload.json"

    spatial_meta, summary = compile_sample(sample_dir)
    viewer_payload = build_viewer_payload(spatial_meta)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(spatial_meta, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    summary_output.write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    viewer_output.write_text(json.dumps(viewer_payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(json.dumps({"output": str(output), "summary": str(summary_output), "viewer": str(viewer_output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
