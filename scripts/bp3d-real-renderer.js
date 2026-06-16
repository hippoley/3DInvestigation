// High-end IFC renderer: web-ifc geometry + programmatic Sky/HDR + PBR
// procedural textures + full post-processing pipeline (SSAO/Bloom/SMAA).
// Zero external assets — everything generated at runtime.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Sky } from "three/addons/objects/Sky.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SAOPass } from "three/addons/postprocessing/SAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { IfcAPI } from "../node_modules/web-ifc/web-ifc-api.js";
import { makePbrMaterials, pickMaterial } from "./bp3d-materials.js";

export async function createRealRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xc4cdd2, 0.012);

  // ---- Procedural Sky + IBL via PMREM ----
  const sky = new Sky();
  sky.scale.setScalar(4500);
  scene.add(sky);
  const sun = new THREE.Vector3();
  const skyU = sky.material.uniforms;
  skyU["turbidity"].value = 4.5;
  skyU["rayleigh"].value = 1.6;
  skyU["mieCoefficient"].value = 0.005;
  skyU["mieDirectionalG"].value = 0.85;
  const phi = THREE.MathUtils.degToRad(90 - 32);
  const theta = THREE.MathUtils.degToRad(155);
  sun.setFromSphericalCoords(1, phi, theta);
  skyU["sunPosition"].value.copy(sun);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(scene, 0.04).texture;
  scene.background = new THREE.Color(0xb6c5d2);

  // ---- Camera + Controls ----
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 800);
  camera.position.set(15, 12, 18);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.5, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 2;
  controls.maxDistance = 120;
  controls.maxPolarAngle = Math.PI * 0.495;

  // ---- Lights ----
  const sunLight = new THREE.DirectionalLight(0xfff1d6, 3.4);
  sunLight.position.copy(sun).multiplyScalar(80);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.radius = 4;
  sunLight.shadow.blurSamples = 16;
  sunLight.shadow.bias = -0.00012;
  Object.assign(sunLight.shadow.camera, { near: 0.5, far: 240, left: -40, right: 40, top: 40, bottom: -40 });
  scene.add(sunLight);
  scene.add(sunLight.target);

  const fill = new THREE.DirectionalLight(0xb8d4ee, 0.9);
  fill.position.set(20, 15, -25);
  scene.add(fill);
  const hemi = new THREE.HemisphereLight(0xeaf2ff, 0x88827a, 0.65);
  scene.add(hemi);

  // ---- Ground (procedural, receives shadows) ----
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(180, 96),
    new THREE.MeshStandardMaterial({ color: 0xa6b1b8, roughness: 0.95, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;
  ground.receiveShadow = true;
  scene.add(ground);

  const root = new THREE.Group();
  scene.add(root);

  // ---- Post-processing pipeline ----
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const sao = new SAOPass(scene, camera);
  sao.params.saoBias = 0.3;
  sao.params.saoIntensity = 0.04;
  sao.params.saoScale = 6;
  sao.params.saoKernelRadius = 28;
  sao.params.saoMinResolution = 0;
  sao.params.saoBlur = true;
  sao.params.saoBlurRadius = 8;
  sao.params.saoBlurStdDev = 4;
  sao.params.saoBlurDepthCutoff = 0.01;
  composer.addPass(sao);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1024, 1024), 0.42, 0.85, 0.92);
  composer.addPass(bloom);
  composer.addPass(new SMAAPass(1024, 1024));
  composer.addPass(new OutputPass());

  // ---- Resize ----
  const resizeObs = new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(2, Math.round(r.width));
    const h = Math.max(2, Math.round(r.height));
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  resizeObs.observe(canvas);

  let running = true;
  function tick() {
    if (!running) return;
    controls.update();
    composer.render();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---- IFC API ----
  const ifcApi = new IfcAPI();
  ifcApi.SetWasmPath("./node_modules/web-ifc/", false);
  await ifcApi.Init();
  const materials = makePbrMaterials();
  const loadedModelIds = [];

  function placedToMesh(modelID, placedGeom, ifcType) {
    const geom = ifcApi.GetGeometry(modelID, placedGeom.geometryExpressID);
    const verts = ifcApi.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
    const indices = ifcApi.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
    const stride = 6;
    const vCount = verts.length / stride;
    const positions = new Float32Array(vCount * 3);
    const normals = new Float32Array(vCount * 3);
    for (let v = 0; v < vCount; v++) {
      positions[v * 3] = verts[v * stride];
      positions[v * 3 + 1] = verts[v * stride + 1];
      positions[v * 3 + 2] = verts[v * stride + 2];
      normals[v * 3] = verts[v * stride + 3];
      normals[v * 3 + 1] = verts[v * stride + 4];
      normals[v * 3 + 2] = verts[v * stride + 5];
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    bg.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    bg.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    bg.computeBoundingBox();
    bg.computeBoundingSphere();
    let mat = pickMaterial(materials, ifcType);
    if (placedGeom.color && placedGeom.color.w !== undefined && placedGeom.color.w < 0.95 && mat !== materials.window) {
      mat = mat.clone();
      mat.transparent = true;
      mat.opacity = Math.max(0.25, placedGeom.color.w);
    }
    const mesh = new THREE.Mesh(bg, mat);
    const m = placedGeom.flatTransformation;
    const matrix = new THREE.Matrix4().fromArray([
      m[0], m[4], m[8], m[12],
      m[1], m[5], m[9], m[13],
      m[2], m[6], m[10], m[14],
      m[3], m[7], m[11], m[15]
    ]).transpose();
    mesh.applyMatrix4(matrix);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    geom.delete();
    return mesh;
  }

  async function loadIfc(url, label = url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch ${url} -> ${resp.status}`);
    const buf = await resp.arrayBuffer();
    const modelID = ifcApi.OpenModel(new Uint8Array(buf));
    loadedModelIds.push(modelID);
    const group = new THREE.Group();
    group.name = label;
    let count = 0;
    ifcApi.StreamAllMeshes(modelID, (flatMesh) => {
      const ifcType = ifcApi.GetLineType(modelID, flatMesh.expressID);
      const placed = flatMesh.geometries;
      for (let i = 0; i < placed.size(); i++) {
        group.add(placedToMesh(modelID, placed.get(i), ifcType));
        count++;
      }
    });
    root.add(group);
    return { count, modelID };
  }

  function fitToScene() {
    if (!root.children.length) return;
    const box = new THREE.Box3().setFromObject(root);
    if (!isFinite(box.min.x)) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fitDist = (maxDim * 0.62) / Math.tan((camera.fov * Math.PI) / 360);
    camera.position.set(center.x + fitDist * 0.78, center.y + fitDist * 0.55, center.z + fitDist * 0.78);
    controls.target.copy(center);
    camera.near = Math.max(0.05, fitDist / 250);
    camera.far = Math.max(200, fitDist * 8);
    camera.updateProjectionMatrix();
    Object.assign(sunLight.shadow.camera, { left: -maxDim, right: maxDim, top: maxDim, bottom: -maxDim, far: maxDim * 4 });
    sunLight.shadow.camera.updateProjectionMatrix();
    sunLight.position.copy(sun).multiplyScalar(maxDim * 1.6).add(center);
    sunLight.target.position.copy(center);
    sunLight.target.updateMatrixWorld();
  }

  function clearAll() {
    while (root.children.length) {
      const c = root.children.pop();
      c.traverse?.((n) => { n.geometry?.dispose?.(); });
    }
    loadedModelIds.forEach((id) => { try { ifcApi.CloseModel(id); } catch {} });
    loadedModelIds.length = 0;
  }

  function setExposure(v) { renderer.toneMappingExposure = v; }
  function setBloom(v) { bloom.strength = v; }

  return {
    loadIfc,
    clearAll,
    fit: fitToScene,
    setExposure,
    setBloom,
    dispose() {
      running = false;
      resizeObs.disconnect();
      clearAll();
      composer.dispose();
      renderer.dispose();
      pmrem.dispose();
    }
  };
}
