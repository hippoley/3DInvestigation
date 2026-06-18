// Module worker: web-ifc parsing off the main thread.
// Receives { type: 'load', jobId, url }
// Streams back { type: 'mesh', jobId, ifcType, positions, normals, indices, transform, color }
// then { type: 'done', jobId, count } or { type: 'error', jobId, message }.
//
// Typed arrays (positions / normals / indices / transform) are transferred,
// not copied, so payload is near-zero overhead per mesh.

import { IfcAPI } from "../node_modules/web-ifc/web-ifc-api.js";

let ifcApi = null;
let initPromise = null;

function ensureInit() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    ifcApi = new IfcAPI();
    // Resolve the wasm directory to an absolute URL so web-ifc's internal
    // path resolver can't get tripped up by base-URL ambiguity inside a worker.
    const wasmDir = new URL("../node_modules/web-ifc/", import.meta.url).href;
    ifcApi.SetWasmPath(wasmDir, true);
    try {
      // forceSingleThread = true. The default tries multi-threaded
      // (web-ifc-mt.wasm + web-ifc-mt.worker.js), which requires both the
      // worker file (missing from web-ifc 0.0.77's npm install) AND
      // crossOriginIsolated (COOP/COEP headers). Without those, Init() would
      // resolve but leave the API in a half-initialised state where
      // OpenModel/StreamAllMeshes silently produce zero geometry.
      await ifcApi.Init(undefined, true);
    } catch (err) {
      throw new Error(`web-ifc Init failed (wasmDir=${wasmDir}): ${err && err.message ? err.message : err}`);
    }
  })();
  return initPromise;
}

function streamMeshes(jobId, modelID) {
  let count = 0;
  ifcApi.StreamAllMeshes(modelID, (flatMesh) => {
    const ifcType = ifcApi.GetLineType(modelID, flatMesh.expressID);
    const expressID = flatMesh.expressID;
    const placed = flatMesh.geometries;
    for (let i = 0; i < placed.size(); i++) {
      const g = placed.get(i);
      const geom = ifcApi.GetGeometry(modelID, g.geometryExpressID);
      const verts = ifcApi.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const indicesRaw = ifcApi.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
      const stride = 6;
      const vCount = verts.length / stride;
      const positions = new Float32Array(vCount * 3);
      const normals = new Float32Array(vCount * 3);
      for (let v = 0; v < vCount; v++) {
        const o = v * stride;
        positions[v * 3]     = verts[o];
        positions[v * 3 + 1] = verts[o + 1];
        positions[v * 3 + 2] = verts[o + 2];
        normals[v * 3]       = verts[o + 3];
        normals[v * 3 + 1]   = verts[o + 4];
        normals[v * 3 + 2]   = verts[o + 5];
      }
      const indices = new Uint32Array(indicesRaw);
      const transform = new Float32Array(g.flatTransformation);
      const color = g.color
        ? { x: g.color.x, y: g.color.y, z: g.color.z, w: g.color.w }
        : null;
      self.postMessage(
        { type: "mesh", jobId, ifcType, expressID, positions, normals, indices, transform, color },
        [positions.buffer, normals.buffer, indices.buffer, transform.buffer]
      );
      count++;
      geom.delete();
    }
  });
  return count;
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (!msg || msg.type !== "load") return;
  const { jobId, url } = msg;
  try {
    await ensureInit();
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch ${url} -> ${resp.status}`);
    const buf = await resp.arrayBuffer();
    // NOTE: COORDINATE_TO_ORIGIN removed. Previously each IFC file was
    // independently centred to (0,0,0), which broke alignment between
    // disciplines (Architecture, MEP, Plumbing, Electrical all got
    // different offsets). This duplex project's raw coords are within
    // ~50 m of origin, so precision is not a concern.
    const modelID = ifcApi.OpenModel(new Uint8Array(buf));
    const count = streamMeshes(jobId, modelID);
    try { ifcApi.CloseModel(modelID); } catch {}
    self.postMessage({ type: "done", jobId, count });
  } catch (err) {
    self.postMessage({
      type: "error",
      jobId,
      message: err && err.message ? err.message : String(err)
    });
  }
};
