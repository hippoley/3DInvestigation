// High-end IFC renderer: web-ifc geometry + programmatic Sky/HDR + PBR
// procedural textures + full post-processing pipeline (SSAO/Bloom/SMAA).
// Zero external assets — everything generated at runtime.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { Sky } from "three/addons/objects/Sky.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { HorizontalBlurShader } from "three/addons/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/addons/shaders/VerticalBlurShader.js";
import { makePbrMaterials, pickMaterial } from "./bp3d-materials.js";

export async function createRealRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;

  const scene = new THREE.Scene();
  // Reduced fog density for better indoor visibility (was 0.012).
  scene.fog = new THREE.FogExp2(0xc4cdd2, 0.006);

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
  const sunLight = new THREE.DirectionalLight(0xfff1d6, 3.8);
  sunLight.position.copy(sun).multiplyScalar(80);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.radius = 4;
  sunLight.shadow.blurSamples = 16;
  sunLight.shadow.bias = -0.00012;
  Object.assign(sunLight.shadow.camera, { near: 0.5, far: 240, left: -40, right: 40, top: 40, bottom: -40 });
  scene.add(sunLight);
  scene.add(sunLight.target);

  const fill = new THREE.DirectionalLight(0xb8d4ee, 1.2);
  fill.position.set(20, 15, -25);
  scene.add(fill);
  // Hemisphere light provides essential indoor fill (sky → ground gradient).
  const hemi = new THREE.HemisphereLight(0xeaf2ff, 0x9e9688, 1.1);
  scene.add(hemi);
  // Soft ambient makes sure no crevice is pitch-black indoors.
  const ambient = new THREE.AmbientLight(0xffffff, 0.15);
  scene.add(ambient);

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

  // ---- Contact shadows (A4) ----
  // Renders the scene into a low-res depth render target from above, blurs
  // it, and projects the result onto a thin transparent plane just under the
  // model. Adds the soft "grounding" shadow that VSM directional shadows
  // can't capture under furniture and walls.
  const SHADOW_RES = 512;
  const csGroup = new THREE.Group();
  csGroup.visible = false;
  scene.add(csGroup);
  const csTarget = new THREE.WebGLRenderTarget(SHADOW_RES, SHADOW_RES);
  csTarget.texture.generateMipmaps = false;
  const csTargetBlur = new THREE.WebGLRenderTarget(SHADOW_RES, SHADOW_RES);
  csTargetBlur.texture.generateMipmaps = false;
  const csCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  csCamera.rotation.x = Math.PI / 2;
  csGroup.add(csCamera);
  const csPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: csTarget.texture,
      transparent: true,
      opacity: 0.78,
      depthWrite: false
    })
  );
  csPlane.renderOrder = 2;
  csGroup.add(csPlane);
  const csBlurPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
  csBlurPlane.visible = false;
  csGroup.add(csBlurPlane);
  const csDepthMaterial = new THREE.MeshDepthMaterial();
  csDepthMaterial.userData.darkness = { value: 1.6 };
  csDepthMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.darkness = csDepthMaterial.userData.darkness;
    shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      "uniform float darkness;\nvoid main() {"
    ).replace(
      "gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );",
      "gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );"
    );
  };
  const csHBlur = new THREE.ShaderMaterial({ ...HorizontalBlurShader });
  csHBlur.depthTest = false;
  const csVBlur = new THREE.ShaderMaterial({ ...VerticalBlurShader });
  csVBlur.depthTest = false;
  let csReady = false;

  function blurContactShadow(amount) {
    csBlurPlane.visible = true;
    csBlurPlane.material = csHBlur;
    csHBlur.uniforms.tDiffuse.value = csTarget.texture;
    csHBlur.uniforms.h.value = (amount * 1) / SHADOW_RES;
    renderer.setRenderTarget(csTargetBlur);
    renderer.render(csBlurPlane, csCamera);
    csBlurPlane.material = csVBlur;
    csVBlur.uniforms.tDiffuse.value = csTargetBlur.texture;
    csVBlur.uniforms.v.value = (amount * 1) / SHADOW_RES;
    renderer.setRenderTarget(csTarget);
    renderer.render(csBlurPlane, csCamera);
    csBlurPlane.visible = false;
  }

  function regenerateContactShadow() {
    if (!root.children.length) return;
    const box = new THREE.Box3().setFromObject(root);
    if (!isFinite(box.min.x)) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const w = Math.max(0.5, size.x * 1.05);
    const d = Math.max(0.5, size.z * 1.05);
    csGroup.position.set(center.x, box.min.y, center.z);
    // PlaneGeometry was baked-rotated into XZ, so the depth axis is Z (not Y).
    // scale.set(w, d, 1) silently scales an axis with no extent; the correct
    // mapping is (X=w, Y=1 placeholder, Z=d).
    csPlane.scale.set(w, 1, d);
    csBlurPlane.scale.set(w, 1, d);
    csCamera.left = -w / 2;
    csCamera.right = w / 2;
    csCamera.top = d / 2;
    csCamera.bottom = -d / 2;
    const camHeight = Math.max(2, size.y * 1.1);
    csCamera.near = 0;
    csCamera.far = camHeight;
    // Camera stays at the group origin (= floor level, since csGroup is at
    // box.min.y) and rotation.x = π/2 makes it look UP, capturing the bottom
    // silhouette of the model within camHeight. Previously we offset the
    // camera UP by camHeight which put it ABOVE the model still looking up
    // — straight into the sky — so the depth buffer captured nothing.
    csCamera.position.set(0, 0, 0);
    csCamera.updateProjectionMatrix();

    // Render the scene's depth into csTarget, then blur twice.
    const prevBg = scene.background;
    const prevOverride = scene.overrideMaterial;
    scene.background = null;
    csGroup.visible = false;
    scene.overrideMaterial = csDepthMaterial;
    renderer.setRenderTarget(csTarget);
    renderer.render(scene, csCamera);
    scene.overrideMaterial = prevOverride;
    blurContactShadow(2.5);
    blurContactShadow(0.7);
    renderer.setRenderTarget(null);
    scene.background = prevBg;
    csGroup.visible = true;
    csReady = true;
  }

  // ---- Post-processing pipeline ----
  // Tuned for ArchViz-y look: contact shadows (already wired above) provide
  // ground-level AO; Bloom only on truly bright emissive (lights, sky); SMAA
  // over MSAA for stable edges.
  //
  // NOTE: SAOPass DISABLED — Three.js r165's SAOPass renders all model pixels
  // as black when the scene has 4000+ meshes. The depth/normal pre-render
  // appears to overflow internal buffers or produce degenerate SAO values.
  // Contact shadows + subtle hemisphere light provide equivalent visual
  // grounding without the catastrophic failure mode. If we want per-object
  // crevice AO back, replace SAOPass with N8AOPass (pmndrs/postprocessing)
  // which handles large scenes correctly.
  // Composer uses canvas actual size (set below in resize observer).
  // Initial size placeholder is overwritten immediately.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Bloom: threshold 0.85 ensures only emissive surfaces (light fixtures,
  // lamps) produce glow. Strength 0.38 is subtle — enough for atmosphere
  // without washing out the scene.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1024, 1024), 0.38, 0.6, 0.85);
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
  // PostFX enabled by default for real browsers. The prior "black screen" was
  // a headless-only issue. Users can toggle via the checkbox.
  let useComposer = true;
  const clock = new THREE.Clock();
  function tick() {
    if (!running) return;
    const delta = clock.getDelta();
    if (fpsActive) { updateFPS(delta); }
    else { controls.update(); }
    if (useComposer) { composer.render(); }
    else { renderer.render(scene, camera); }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---- IFC parsing (off main thread) ----
  // The web-ifc wasm and IFC StreamAllMeshes loop is CPU-heavy and previously
  // blocked the render loop. We push parsing into a module worker and only
  // do BufferGeometry assembly + material picking on the main thread, so the
  // composer keeps drawing at 60 fps while a 30 MB Plumbing IFC streams in.
  const materials = makePbrMaterials();
  const ifcWorker = new Worker(new URL("./bp3d-ifc-worker.js", import.meta.url), { type: "module" });
  const pendingJobs = new Map();   // jobId -> { resolve, reject, group, count, label }
  let nextJobId = 1;
  let workerDead = false;

  ifcWorker.addEventListener("error", (e) => {
    workerDead = true;
    const err = new Error(`ifc-worker error: ${e.message || e.type}`);
    pendingJobs.forEach((job) => job.reject(err));
    pendingJobs.clear();
  });

  ifcWorker.addEventListener("message", (ev) => {
    const msg = ev.data;
    if (!msg || !pendingJobs.has(msg.jobId)) return;
    const job = pendingJobs.get(msg.jobId);
    if (msg.type === "mesh") {
      job.group.add(buildMeshFromPayload(msg));
      job.count++;
    } else if (msg.type === "done") {
      pendingJobs.delete(msg.jobId);
      root.add(job.group);
      // Respect the current level filter for this newly-arrived group. The
      // system filter was already wired in loadIfc() when the group was
      // created, so all we need here is the level pass.
      applyLevelToGroup(job.group);
      job.resolve({ count: job.count, group: job.group });
    } else if (msg.type === "error") {
      pendingJobs.delete(msg.jobId);
      job.reject(new Error(msg.message));
    }
  });

  function buildMeshFromPayload(msg) {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(msg.positions, 3));
    bg.setAttribute("normal", new THREE.BufferAttribute(msg.normals, 3));
    bg.setIndex(new THREE.BufferAttribute(msg.indices, 1));
    bg.computeBoundingBox();
    bg.computeBoundingSphere();
    let mat = pickMaterial(materials, msg.ifcType);
    if (msg.color && msg.color.w !== undefined && msg.color.w < 0.95 && mat !== materials.window) {
      mat = mat.clone();
      mat.transparent = true;
      mat.opacity = Math.max(0.25, msg.color.w);
    }
    const mesh = new THREE.Mesh(bg, mat);
    mesh.userData.ifcType = msg.ifcType;
    mesh.userData.expressID = msg.expressID ?? null;
    const t = msg.transform;
    // web-ifc returns column-major; .fromArray(...) followed by transpose() converts to Three's convention.
    const matrix = new THREE.Matrix4().fromArray([
      t[0], t[4], t[8],  t[12],
      t[1], t[5], t[9],  t[13],
      t[2], t[6], t[10], t[14],
      t[3], t[7], t[11], t[15]
    ]).transpose();
    mesh.applyMatrix4(matrix);
    // IfcSpace volumes are invisible helper geometry — skip shadow casting
    const isSpace = msg.ifcType === 3856911033 || msg.ifcType === 652456506;
    mesh.castShadow = !isSpace;
    mesh.receiveShadow = !isSpace;
    return mesh;
  }

  function loadIfc(url, label = url, system = null) {
    if (workerDead) return Promise.reject(new Error("ifc-worker terminated"));
    const jobId = nextJobId++;
    const group = new THREE.Group();
    group.name = label;
    const systemId = system || label.toLowerCase();
    group.userData.system = systemId;
    // Default each system to visible. setSystemVisibility() will override.
    if (!systemEnabled.has(systemId)) systemEnabled.set(systemId, true);
    group.visible = systemEnabled.get(systemId);
    // Resolve to an absolute URL on the main thread. The worker lives at
    // /scripts/bp3d-ifc-worker.js, so a relative URL like "./samples/..."
    // would otherwise resolve to /scripts/samples/... inside the worker
    // and 404. Passing a fully-qualified URL avoids any base-URL drift.
    const absoluteUrl = new URL(url, location.href).href;
    return new Promise((resolve, reject) => {
      pendingJobs.set(jobId, { resolve, reject, group, count: 0, label });
      ifcWorker.postMessage({ type: "load", jobId, url: absoluteUrl });
    });
  }

  // ---- Layer filters (system + level) ----
  // Two independent visibility axes that compose multiplicatively:
  //   mesh.visible = systemEnabled[group.userData.system] && passesLevelFilter(mesh)
  // System visibility is applied at group level (cheap). Level visibility is
  // per-mesh (mesh world bbox center vs [min, max] on the height axis), and is
  // cached in mesh.userData._heightY at first evaluation.
  // "spaces" (IfcSpace room volumes) hidden by default — they are ghost volumes
  // that obscure real geometry when rendered opaque.
  const systemEnabled = new Map([["spaces", false]]);   // systemId -> bool
  let levelRange = null;             // null = pass-all, else { min, max }

  function meshHeightCenter(mesh) {
    if (mesh.userData._heightY !== undefined) return mesh.userData._heightY;
    const bb = mesh.geometry?.boundingBox;
    if (!bb) return 0;
    const c = bb.getCenter(new THREE.Vector3());
    mesh.updateMatrixWorld();
    c.applyMatrix4(mesh.matrixWorld);
    // Three.js Y-up convention: ground rotated to XZ plane, csGroup placed at
    // box.min.y elsewhere in this file all assume Y is height.
    mesh.userData._heightY = c.y;
    return c.y;
  }

  function applyLevelToGroup(group) {
    if (!levelRange) {
      group.traverse((obj) => { if (obj.isMesh) obj.visible = true; });
      return;
    }
    const { min, max } = levelRange;
    group.traverse((obj) => {
      if (!obj.isMesh) return;
      const y = meshHeightCenter(obj);
      obj.visible = y >= min && y < max;
    });
  }

  function setSystemVisibility(systemId, visible) {
    systemEnabled.set(systemId, !!visible);
    root.children.forEach((group) => {
      if (group.userData.system === systemId) group.visible = !!visible;
    });
  }

  function setLevelFilter(range) {
    // range: null | { min: number, max: number } in world Y units. ±Infinity is
    // intentionally allowed as an open boundary (top/bottom levels). Reject
    // only NaN or non-numeric values; collapse to pass-all on null/undefined.
    const validBound = (n) => typeof n === "number" && !Number.isNaN(n);
    levelRange = range && validBound(range.min) && validBound(range.max) && range.min < range.max
      ? { min: range.min, max: range.max }
      : null;
    root.children.forEach(applyLevelToGroup);
  }

  function getKnownSystems() {
    return Array.from(systemEnabled.keys());
  }

  function debugVisibilityStats() {
    // Returns counts of meshes by group system + total visible/hidden, plus
    // the world-Y range observed across all meshes. Used by the smoke test
    // to validate that setLevelFilter actually mutates mesh.visible (i.e.
    // the height-axis assumption holds) without exposing internal scene refs.
    const stats = { total: 0, visible: 0, hidden: 0, minY: Infinity, maxY: -Infinity, perSystem: {} };
    root.children.forEach((group) => {
      const sys = group.userData.system || "unknown";
      const bucket = stats.perSystem[sys] || (stats.perSystem[sys] = { total: 0, visible: 0, groupVisible: group.visible });
      group.traverse((obj) => {
        if (!obj.isMesh) return;
        stats.total++;
        bucket.total++;
        const y = meshHeightCenter(obj);
        if (Number.isFinite(y)) {
          if (y < stats.minY) stats.minY = y;
          if (y > stats.maxY) stats.maxY = y;
        }
        // Effective visibility = group.visible AND mesh.visible
        const eff = group.visible && obj.visible;
        if (eff) { stats.visible++; bucket.visible++; }
        else { stats.hidden++; }
      });
    });
    return stats;
  }

  function debugGroupBboxes() {
    // Returns per-group (per IFC file) bounding box info for alignment diagnosis.
    const results = [];
    root.children.forEach((group) => {
      const box = new THREE.Box3().setFromObject(group);
      if (!isFinite(box.min.x)) return;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      results.push({
        name: group.name,
        system: group.userData.system,
        meshCount: 0,
        center: { x: +center.x.toFixed(3), y: +center.y.toFixed(3), z: +center.z.toFixed(3) },
        size: { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) },
        min: { x: +box.min.x.toFixed(3), y: +box.min.y.toFixed(3), z: +box.min.z.toFixed(3) },
        max: { x: +box.max.x.toFixed(3), y: +box.max.y.toFixed(3), z: +box.max.z.toFixed(3) }
      });
      let mc = 0;
      group.traverse((o) => { if (o.isMesh) mc++; });
      results[results.length - 1].meshCount = mc;
    });
    return results;
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

  // Fly camera into the interior of the building at a given level elevation.
  // Positions the camera at eye-height (1.6 m above level) near the plan
  // centroid, looking toward the opposite corner — gives a "walkthrough" feel.
  function flyToInterior(levelElevation = 0) {
    if (!root.children.length) return;
    const box = new THREE.Box3().setFromObject(root);
    if (!isFinite(box.min.x)) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const eyeY = levelElevation + 1.6;
    // Position slightly off-center for perspective depth
    const cx = center.x + size.x * 0.15;
    const cz = center.z + size.z * 0.15;
    camera.position.set(cx, eyeY, cz);
    // Look toward the far corner
    controls.target.set(center.x - size.x * 0.3, eyeY - 0.2, center.z - size.z * 0.3);
    camera.near = 0.05;
    camera.far = Math.max(200, size.length() * 4);
    camera.updateProjectionMatrix();
    controls.update();
  }

  function clearAll() {
    // Reject any in-flight worker jobs so awaiters don't hang.
    pendingJobs.forEach((job) => job.reject(new Error("renderer cleared")));
    pendingJobs.clear();
    while (root.children.length) {
      const c = root.children.pop();
      c.traverse?.((n) => { n.geometry?.dispose?.(); });
    }
  }

  // ---- FPS Walkthrough Mode ----
  // PointerLockControls for first-person camera. WASD movement with simple
  // bbox-based boundary clamping (keeps player inside the building).
  const fpsControls = new PointerLockControls(camera, canvas);
  let fpsActive = false;
  const fpsVelocity = new THREE.Vector3();
  const fpsDirection = new THREE.Vector3();
  const FPS_SPEED = 3.5; // m/s
  const FPS_EYE_HEIGHT = 1.6;
  const keysDown = new Set();
  let fpsBounds = null; // { min: Vector3, max: Vector3 }

  canvas.addEventListener("keydown", (e) => keysDown.add(e.code));
  canvas.addEventListener("keyup", (e) => keysDown.delete(e.code));
  // Also reset keys on blur to prevent stuck keys
  window.addEventListener("blur", () => keysDown.clear());

  fpsControls.addEventListener("lock", () => {
    fpsActive = true;
    controls.enabled = false;
    // Compute building bounds for collision
    if (root.children.length) {
      const box = new THREE.Box3().setFromObject(root);
      fpsBounds = { min: box.min.clone(), max: box.max.clone() };
    }
  });
  fpsControls.addEventListener("unlock", () => {
    fpsActive = false;
    controls.enabled = true;
    keysDown.clear();
  });

  function updateFPS(delta) {
    if (!fpsActive) return;
    // Direction from WASD
    fpsDirection.set(0, 0, 0);
    if (keysDown.has("KeyW") || keysDown.has("ArrowUp")) fpsDirection.z -= 1;
    if (keysDown.has("KeyS") || keysDown.has("ArrowDown")) fpsDirection.z += 1;
    if (keysDown.has("KeyA") || keysDown.has("ArrowLeft")) fpsDirection.x -= 1;
    if (keysDown.has("KeyD") || keysDown.has("ArrowRight")) fpsDirection.x += 1;
    if (fpsDirection.lengthSq() > 0) fpsDirection.normalize();

    // Move along camera facing direction
    fpsVelocity.set(0, 0, 0);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0; forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    fpsVelocity.addScaledVector(forward, -fpsDirection.z * FPS_SPEED * delta);
    fpsVelocity.addScaledVector(right, fpsDirection.x * FPS_SPEED * delta);

    camera.position.add(fpsVelocity);
    // Clamp to building bounds (simple collision)
    if (fpsBounds) {
      const pad = 0.3;
      camera.position.x = Math.max(fpsBounds.min.x + pad, Math.min(fpsBounds.max.x - pad, camera.position.x));
      camera.position.z = Math.max(fpsBounds.min.z + pad, Math.min(fpsBounds.max.z - pad, camera.position.z));
    }
  }

  function enterFPS(levelElevation = 0) {
    // Position camera inside the building and lock pointer
    if (!root.children.length) return;
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    camera.position.set(center.x, levelElevation + FPS_EYE_HEIGHT, center.z);
    camera.near = 0.05;
    camera.far = 200;
    camera.updateProjectionMatrix();
    fpsControls.lock();
  }

  function exitFPS() {
    fpsControls.unlock();
  }

  function setExposure(v) { renderer.toneMappingExposure = v; }
  function setBloom(v) { bloom.strength = v; }
  function setContactShadowOpacity(v) {
    csPlane.material.opacity = Math.max(0, Math.min(1, v));
    csPlane.visible = v > 0.001;
  }
  function setPostProcessing(enabled) { useComposer = !!enabled; }

  // ---- Sun position control ----
  // Updates Sky shader sun direction + directional light + re-generates IBL.
  function setSunPosition(elevationDeg, azimuthDeg) {
    const p = THREE.MathUtils.degToRad(90 - elevationDeg);
    const t = THREE.MathUtils.degToRad(azimuthDeg);
    sun.setFromSphericalCoords(1, p, t);
    skyU["sunPosition"].value.copy(sun);
    // Regenerate IBL from updated sky. This is relatively heavy (~50ms) so
    // callers should debounce rapid changes (slider input events).
    const newEnv = pmrem.fromScene(scene, 0.04).texture;
    if (scene.environment) scene.environment.dispose();
    scene.environment = newEnv;
    // Move directional light to match sun
    const fitDist = sunLight.position.length() || 80;
    sunLight.position.copy(sun).multiplyScalar(fitDist);
  }

  // ---- Raycaster picking ----
  // pointerdown/pointerup with 5px drag threshold so orbit doesn't trigger pick.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let selectedMesh = null;
  let selectedOriginalEmissive = null;
  let onSelectCallback = null;

  const HIGHLIGHT_COLOR = new THREE.Color(0x00bcd4);
  let _ptrDown = null; // { x, y } screen coords at pointerdown

  function clearSelection() {
    if (selectedMesh && selectedMesh.material) {
      if (selectedMesh.material.emissive) {
        selectedMesh.material.emissive.copy(selectedOriginalEmissive || new THREE.Color(0));
      }
      selectedMesh.material.emissiveIntensity = 0;
    }
    const wasSel = !!selectedMesh;
    selectedMesh = null;
    selectedOriginalEmissive = null;
    if (wasSel && onSelectCallback) onSelectCallback(null);
  }

  function highlightMesh(mesh) {
    clearSelection();
    if (!mesh || !mesh.material) return;
    selectedMesh = mesh;
    selectedOriginalEmissive = mesh.material.emissive ? mesh.material.emissive.clone() : new THREE.Color(0);
    if (mesh.material.emissive) mesh.material.emissive.copy(HIGHLIGHT_COLOR);
    mesh.material.emissiveIntensity = 0.4;
  }

  function onPointerDown(event) {
    _ptrDown = { x: event.clientX, y: event.clientY };
  }
  function onPointerUp(event) {
    if (!_ptrDown) return;
    const dx = event.clientX - _ptrDown.x;
    const dy = event.clientY - _ptrDown.y;
    _ptrDown = null;
    if (dx * dx + dy * dy > 25) return; // moved > 5px — orbit drag, skip

    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(root.children, true);
    const hit = hits.find((h) => h.object.isMesh && h.object.visible);
    if (hit && hit.object !== selectedMesh) {
      highlightMesh(hit.object);
      if (onSelectCallback) {
        onSelectCallback({
          mesh: hit.object,
          ifcType: hit.object.userData.ifcType || null,
          expressID: hit.object.userData.expressID || null,
          system: hit.object.parent?.userData?.system || null,
          position: hit.point.clone()
        });
      }
    } else {
      clearSelection();
    }
  }
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);

  // ---- Day/Night atmosphere ----
  // Controls sun elevation, indoor warm fill, and ambient color temperature
  // in one coordinated "time of day" value from 0 (noon) to 1 (night).
  let dayNightMix = 0; // 0 = day, 1 = night
  function setTimeOfDay(t) {
    dayNightMix = Math.max(0, Math.min(1, t));
    // Sun elevation: 32° at noon → 2° at dusk
    const elev = THREE.MathUtils.lerp(32, 2, dayNightMix);
    setSunPosition(elev, 155);
    // Background: day sky → dark blue
    const dayBg = new THREE.Color(0xb6c5d2);
    const nightBg = new THREE.Color(0x1a2030);
    scene.background = dayBg.clone().lerp(nightBg, dayNightMix);
    // Fog color follows background
    scene.fog.color.copy(scene.background);
    // Hemisphere light: bright sky → dim warm
    hemi.intensity = THREE.MathUtils.lerp(1.1, 0.25, dayNightMix);
    hemi.color.set(dayNightMix < 0.5 ? 0xeaf2ff : 0xffe8c0);
    // Ambient: brighter at night to simulate indoor lights
    ambient.intensity = THREE.MathUtils.lerp(0.15, 0.35, dayNightMix);
    ambient.color.set(dayNightMix > 0.5 ? 0xffeedd : 0xffffff);
    // Sun intensity drops at night
    sunLight.intensity = THREE.MathUtils.lerp(3.8, 0.3, dayNightMix);
    // Fill light warms up at night
    fill.intensity = THREE.MathUtils.lerp(1.2, 0.5, dayNightMix);
    fill.color.set(dayNightMix > 0.5 ? 0xffe0b0 : 0xb8d4ee);
    // Exposure slight bump at night for indoor visibility
    renderer.toneMappingExposure = THREE.MathUtils.lerp(1.22, 1.4, dayNightMix);
  }

  function onSelect(callback) { onSelectCallback = callback; }

  return {
    loadIfc,
    clearAll,
    fit: fitToScene,
    regenerateContactShadow,
    isContactShadowReady: () => csReady,
    setExposure,
    setBloom,
    setContactShadowOpacity,
    setSystemVisibility,
    setLevelFilter,
    getKnownSystems,
    debugVisibilityStats,
    debugGroupBboxes,
    setPostProcessing,
    setSunPosition,
    setTimeOfDay,
    flyToInterior,
    enterFPS,
    exitFPS,
    isFPS: () => fpsActive,
    onSelect,
    clearSelection,
    dispose() {
      running = false;
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      resizeObs.disconnect();
      clearAll();
      try { fpsControls.dispose(); } catch {}
      try { ifcWorker.terminate(); } catch {}
      workerDead = true;
      try { csTarget.dispose(); csTargetBlur.dispose(); } catch {}
      try { csHBlur.dispose(); csVBlur.dispose(); csDepthMaterial.dispose(); } catch {}
      composer.dispose();
      renderer.dispose();
      pmrem.dispose();
    }
  };
}
