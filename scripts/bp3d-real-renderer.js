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
import { HorizontalBlurShader } from "three/addons/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/addons/shaders/VerticalBlurShader.js";
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
  // Tuned for ArchViz-y look: subtle SAO for crevice darkening, tight Bloom only on
  // truly bright emissive (lights, sky), SMAA over MSAA for stable edges with deferred-style passes.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const sao = new SAOPass(scene, camera);
  sao.params.saoBias = 0.25;
  sao.params.saoIntensity = 0.06;        // up from 0.04 — crevices get more readable
  sao.params.saoScale = 4;
  sao.params.saoKernelRadius = 18;       // down from 28 — sharper contact AO, less "fog"
  sao.params.saoMinResolution = 0;
  sao.params.saoBlur = true;
  sao.params.saoBlurRadius = 6;
  sao.params.saoBlurStdDev = 3.5;
  sao.params.saoBlurDepthCutoff = 0.01;
  composer.addPass(sao);
  // strength 0.32 (was 0.42), threshold 0.92 (was 0.85): only true emissives bloom.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1024, 1024), 0.32, 0.7, 0.92);
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
    const t = msg.transform;
    // web-ifc returns column-major; .fromArray(...) followed by transpose() converts to Three's convention.
    const matrix = new THREE.Matrix4().fromArray([
      t[0], t[4], t[8],  t[12],
      t[1], t[5], t[9],  t[13],
      t[2], t[6], t[10], t[14],
      t[3], t[7], t[11], t[15]
    ]).transpose();
    mesh.applyMatrix4(matrix);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function loadIfc(url, label = url, system = null) {
    if (workerDead) return Promise.reject(new Error("ifc-worker terminated"));
    const jobId = nextJobId++;
    const group = new THREE.Group();
    group.name = label;
    group.userData.system = system || label.toLowerCase();
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
    // Reject any in-flight worker jobs so awaiters don't hang.
    pendingJobs.forEach((job) => job.reject(new Error("renderer cleared")));
    pendingJobs.clear();
    while (root.children.length) {
      const c = root.children.pop();
      c.traverse?.((n) => { n.geometry?.dispose?.(); });
    }
  }

  function setExposure(v) { renderer.toneMappingExposure = v; }
  function setBloom(v) { bloom.strength = v; }
  function setContactShadowOpacity(v) {
    csPlane.material.opacity = Math.max(0, Math.min(1, v));
    csPlane.visible = v > 0.001;
  }

  return {
    loadIfc,
    clearAll,
    fit: fitToScene,
    regenerateContactShadow,
    isContactShadowReady: () => csReady,
    setExposure,
    setBloom,
    setContactShadowOpacity,
    dispose() {
      running = false;
      resizeObs.disconnect();
      clearAll();
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
