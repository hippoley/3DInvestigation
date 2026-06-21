// High-end IFC renderer: web-ifc geometry + HDR environment + PBR
// procedural textures + full post-processing pipeline (GTAO/Bloom/SMAA).
// Default env: assets/hdri/glasshouse_interior_4k.exr for indoor reflections.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { Sky } from "three/addons/objects/Sky.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { SSRPass } from "three/addons/postprocessing/SSRPass.js";
import { HorizontalBlurShader } from "three/addons/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/addons/shaders/VerticalBlurShader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { ColorGradingShader } from "./bp3d-color-grading.js";
import { classifyFurnitureMaterial, pickMaterial } from "./bp3d-materials.js";
import { MaterialFactory } from "./bp3d-material-factory.js";
import { LightFactory } from "./bp3d-light-factory.js";
import { CameraTour, SCENE_TOURS } from "./bp3d-camera-tour.js";

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

  // ---- Procedural Sky (background) + Indoor IBL (reflections) ----
  // Sky is kept for outdoor background. But for material reflections we
  // generate a separate "indoor studio" environment: warm neutral lighting
  // that makes metals/glossy surfaces look correct indoors (not blue sky).
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

  // ---- HDR Environment (reflections + ambient lighting) ----
  // Load a real HDR/EXR for accurate indoor reflections on metals/glass. Falls back
  // to a programmatic Sky env if loading fails.
  const DEFAULT_HDR = 'assets/hdri/glasshouse_interior_4k.exr';
  async function loadHdrEnv(url) {
    const ext = url.split('.').pop().toLowerCase();
    let texture;
    if (ext === 'exr') {
      const { EXRLoader } = await import('three/addons/loaders/EXRLoader.js');
      texture = await new EXRLoader().loadAsync(url);
    } else {
      texture = await new RGBELoader().loadAsync(url);
    }
    return texture;
  }
  let hdrEnvMap = null;
  const scheduleIdle = (fn, timeout = 8000) => {
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(fn, { timeout });
    } else {
      setTimeout(fn, timeout);
    }
  };
  scheduleIdle(() => {
    loadHdrEnv(DEFAULT_HDR)
      .then((hdrTexture) => {
        hdrEnvMap = pmrem.fromEquirectangular(hdrTexture).texture;
        hdrTexture.dispose();
        scene.environment = hdrEnvMap;
        markDirty();
        console.log("[renderer] HDR environment loaded:", DEFAULT_HDR);
      })
      .catch((err) => {
        console.warn("[renderer] HDR load failed, using procedural sky env:", err);
        const skyEnvMap = pmrem.fromScene(scene, 0.04).texture;
        scene.environment = skyEnvMap;
        markDirty();
      });
  });

  // Set initial environment from sky while HDR loads asynchronously
  scene.environment = pmrem.fromScene(scene, 0.04).texture;
  scene.environmentIntensity = 0.85; // slightly reduced for indoor — HDR can be intense
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
  sunLight.shadow.mapSize.set(4096, 4096); // 4K shadow map for crisp indoor shadows
  sunLight.shadow.radius = 3;
  sunLight.shadow.blurSamples = 24;
  sunLight.shadow.bias = -0.0001;
  sunLight.shadow.normalBias = 0.02; // reduces peter-panning on thin geometry
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

  // ---- Floor Reflector: blurred roughness-aware planar reflection ----
  // Architecture:
  //   1. A MirrorCamera (flipped Y) renders the scene into `reflRT` every frame.
  //   2. `reflBlurRT` holds a horizontally-blurred copy; vertical blur is written
  //      back into `reflRT` — classic ping-pong.  One pass of 7-tap Gaussian blur.
  //   3. The floor plane samples `reflRT` via a custom ShaderMaterial that does:
  //      - clip-space → NDC → UV mapping (perspective-correct planar reflection)
  //      - roughness-driven blur magnitude
  //      - Fresnel-based opacity (edge-on = more reflective)
  //   4. `roughnessValue` drives both the number of blur iterations and the
  //      sample spread, so callers can call setFloorReflection(opacity, roughness).
  const REFL_RES = 512;
  const reflRT      = new THREE.WebGLRenderTarget(REFL_RES, REFL_RES, {
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true
  });
  const reflBlurRT  = new THREE.WebGLRenderTarget(REFL_RES, REFL_RES, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter
  });

  // Mirror camera: same projection as main camera but reflected across Y = 0
  const reflCamera = new THREE.PerspectiveCamera();
  let reflRoughness = 0.68; // how blurry the reflection is, 0 = mirror, 1 = fully diffuse

  // Blur ping-pong planes (full-screen quads driven by a custom camera)
  const reflBlurCam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
  const reflHBlurMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: reflRT.texture },
      resolution: { value: new THREE.Vector2(REFL_RES, REFL_RES) },
      blurRadius: { value: 2.5 }
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform vec2 resolution;
      uniform float blurRadius;
      varying vec2 vUv;
      void main() {
        vec2 step = vec2(blurRadius / resolution.x, 0.0);
        vec3 c =  texture2D(tDiffuse, vUv).rgb                      * 0.2270;
        c      += texture2D(tDiffuse, vUv + step * 1.0).rgb         * 0.1945;
        c      += texture2D(tDiffuse, vUv - step * 1.0).rgb         * 0.1945;
        c      += texture2D(tDiffuse, vUv + step * 2.0).rgb         * 0.1216;
        c      += texture2D(tDiffuse, vUv - step * 2.0).rgb         * 0.1216;
        c      += texture2D(tDiffuse, vUv + step * 3.0).rgb         * 0.0540;
        c      += texture2D(tDiffuse, vUv - step * 3.0).rgb         * 0.0540;
        c      += texture2D(tDiffuse, vUv + step * 4.0).rgb         * 0.0162;
        c      += texture2D(tDiffuse, vUv - step * 4.0).rgb         * 0.0162;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    depthTest: false, depthWrite: false
  });
  const reflVBlurMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: reflBlurRT.texture },
      resolution: { value: new THREE.Vector2(REFL_RES, REFL_RES) },
      blurRadius: { value: 2.5 }
    },
    vertexShader: reflHBlurMat.vertexShader,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform vec2 resolution;
      uniform float blurRadius;
      varying vec2 vUv;
      void main() {
        vec2 step = vec2(0.0, blurRadius / resolution.y);
        vec3 c =  texture2D(tDiffuse, vUv).rgb                      * 0.2270;
        c      += texture2D(tDiffuse, vUv + step * 1.0).rgb         * 0.1945;
        c      += texture2D(tDiffuse, vUv - step * 1.0).rgb         * 0.1945;
        c      += texture2D(tDiffuse, vUv + step * 2.0).rgb         * 0.1216;
        c      += texture2D(tDiffuse, vUv - step * 2.0).rgb         * 0.1216;
        c      += texture2D(tDiffuse, vUv + step * 3.0).rgb         * 0.0540;
        c      += texture2D(tDiffuse, vUv - step * 3.0).rgb         * 0.0540;
        c      += texture2D(tDiffuse, vUv + step * 4.0).rgb         * 0.0162;
        c      += texture2D(tDiffuse, vUv - step * 4.0).rgb         * 0.0162;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    depthTest: false, depthWrite: false
  });
  const reflBlurQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), reflHBlurMat);

  // Floor plane with custom projection-based reflection material
  const reflFloorGeom = new THREE.PlaneGeometry(20, 30);
  const reflFloorMat = new THREE.ShaderMaterial({
    uniforms: {
      tReflection: { value: reflRT.texture },
      opacity:     { value: 0.08 },
      roughness:   { value: reflRoughness }
    },
    vertexShader: /* glsl */`
      varying vec4 vClipPos;
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vClipPos = projectionMatrix * viewMatrix * worldPos;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = vClipPos;
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D tReflection;
      uniform float opacity;
      uniform float roughness;
      varying vec4 vClipPos;
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;

      // Schlick Fresnel: more reflective at grazing angles
      float fresnel(vec3 N, vec3 V) {
        float f0 = 0.04;
        return f0 + (1.0 - f0) * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 5.0);
      }

      void main() {
        // Perspective-correct UV from clip space
        vec2 ndc = (vClipPos.xy / vClipPos.w) * 0.5 + 0.5;

        // Roughness-based UV jitter (baked Gaussian noise approximation):
        // 2×2 rotated offsets scaled by roughness give a blurry look at the
        // material level without a second blur pass at high roughness.
        float jit = roughness * 0.012;
        vec2 uv0 = ndc + vec2( jit,  jit * 0.6);
        vec2 uv1 = ndc + vec2(-jit,  jit * 0.6);
        vec2 uv2 = ndc + vec2( 0.0, -jit * 1.2);
        vec3 reflColor = (
          texture2D(tReflection, uv0).rgb +
          texture2D(tReflection, uv1).rgb +
          texture2D(tReflection, uv2).rgb
        ) / 3.0;

        // Fade edges so the hard clip rectangle isn't visible
        vec2 edge = smoothstep(0.0, 0.08, ndc) * (1.0 - smoothstep(0.92, 1.0, ndc));
        float edgeFade = edge.x * edge.y;

        float f = fresnel(vWorldNormal, vViewDir);
        float alpha = opacity * (1.0 - roughness * 0.7) * edgeFade * (0.5 + f * 1.5);

        gl_FragColor = vec4(reflColor, clamp(alpha, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false
  });

  const floorReflector = new THREE.Mesh(reflFloorGeom, reflFloorMat);
  floorReflector.rotation.x = -Math.PI / 2;
  floorReflector.position.set(4.4, 0.01, 8.9);
  floorReflector.renderOrder = 1;
  floorReflector.visible = false;
  scene.add(floorReflector);
  let reflectorEnabled = false;

  // Reflection texture update: called once per frame when reflectorEnabled.
  // Mirrors the scene across the floor plane (Y=0), renders into reflRT,
  // then runs one Gaussian H+V blur pass to simulate roughness.
  function _updateReflection() {
    if (!reflectorEnabled) return;

    // Mirror camera: copy main camera then flip Y position and scale Z of view matrix
    reflCamera.copy(camera);
    reflCamera.position.y = -camera.position.y + floorReflector.position.y * 2;
    reflCamera.rotation.x = -camera.rotation.x;
    reflCamera.rotation.z = -camera.rotation.z;
    reflCamera.updateMatrixWorld();

    // Hide the floor plane itself during reflection render to avoid self-occlusion
    floorReflector.visible = false;

    const prevBg = scene.background;
    renderer.setRenderTarget(reflRT);
    renderer.render(scene, reflCamera);
    renderer.setRenderTarget(null);
    scene.background = prevBg;

    floorReflector.visible = true;

    // Gaussian blur pass (only when roughness > 0.05)
    if (reflRoughness > 0.05) {
      const rad = reflRoughness * 6.0;
      reflHBlurMat.uniforms.blurRadius.value = rad;
      reflVBlurMat.uniforms.blurRadius.value = rad;

      // H blur: reflRT → reflBlurRT
      reflHBlurMat.uniforms.tDiffuse.value = reflRT.texture;
      reflBlurQuad.material = reflHBlurMat;
      renderer.setRenderTarget(reflBlurRT);
      renderer.render(reflBlurQuad, reflBlurCam);

      // V blur: reflBlurRT → reflRT
      reflVBlurMat.uniforms.tDiffuse.value = reflBlurRT.texture;
      reflBlurQuad.material = reflVBlurMat;
      renderer.setRenderTarget(reflRT);
      renderer.render(reflBlurQuad, reflBlurCam);

      renderer.setRenderTarget(null);
    }

    // Sync the floor shader's reflection texture
    reflFloorMat.uniforms.tReflection.value = reflRT.texture;
    reflFloorMat.uniforms.roughness.value = reflRoughness;
  }

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
      opacity: 0.46,
      depthWrite: false
    })
  );
  csPlane.renderOrder = 2;
  csGroup.add(csPlane);
  const csBlurPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
  csBlurPlane.visible = false;
  csGroup.add(csBlurPlane);
  const csDepthMaterial = new THREE.MeshDepthMaterial();
  csDepthMaterial.userData.darkness = { value: 1.05 };
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
  // GTAO: Ground Truth Ambient Occlusion — adds contact shadows and spatial
  // depth cues in crevices, under furniture, at wall-floor junctions. Much more
  // stable than SAOPass on large-mesh scenes.
  const gtao = new GTAOPass(scene, camera, 1024, 1024);
  gtao.output = GTAOPass.OUTPUT.Default; // render scene + blend AO on top
  // AO parameters tuned for indoor arch-viz: moderate radius, visible darkness
  gtao.updateGtaoMaterial({ radius: 0.38, distanceExponent: 2, thickness: 1.25, scale: 0.7, samples: 16 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 16 });
  gtao.blendIntensity = 0.55;
  composer.addPass(gtao);
  // SSR: Screen Space Reflections — adds dynamic reflections to all glossy
  // surfaces (metal, glass, polished floors) without needing planar reflectors.
  // Selective mode: only meshes whose material passes the metalness/roughness
  // threshold receive SSR, avoiding wasted GPU on matte walls.
  const ssrPass = new SSRPass({ renderer, scene, camera, width: 1024, height: 1024 });
  ssrPass.thickness = 0.02;       // thin geometry support
  ssrPass.maxDistance = 8;        // max reflection ray travel in world units
  ssrPass.opacity = 0.5;         // blend strength (subtle, not mirror-like)
  ssrPass.blur = true;
  let ssrEnabled = false;
  ssrPass.enabled = false;
  composer.addPass(ssrPass);
  // Bloom: low threshold (0.55) so light fixtures with emissiveIntensity 2.5
  // clearly glow. strength 0.6 for a visible warm halo effect.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1024, 1024), 0.6, 0.5, 0.55);
  composer.addPass(bloom);
  composer.addPass(new SMAAPass(1024, 1024));
  // Color grading: vignette + warm temperature + contrast for archviz photo feel
  const colorGrading = new ShaderPass(ColorGradingShader);
  composer.addPass(colorGrading);
  composer.addPass(new OutputPass());

  // ---- Light factory (preset templates) ----
  const lightFactory = new LightFactory({ sunLight, fill, hemi, ambient, scene, renderer, colorGrading });
  // Default preset matches the hard-coded initial values already set above, so no
  // re-application is needed on startup — but we track the name for getActivePreset().
  lightFactory._activePreset = 'daylight';

  // Internal helper: load and apply an HDR/EXR as the scene environment.
  async function _applyHdriUrl(url) {
    if (!url) return;
    try {
      const ext = url.split('.').pop().toLowerCase();
      let texture;
      if (ext === 'exr') {
        const { EXRLoader } = await import('three/addons/loaders/EXRLoader.js');
        texture = await new EXRLoader().loadAsync(url);
      } else {
        texture = await new RGBELoader().loadAsync(url);
      }
      const newEnv = pmrem.fromEquirectangular(texture).texture;
      texture.dispose();
      if (scene.environment) scene.environment.dispose();
      scene.environment = newEnv;
      markDirty();
      console.log(`[renderer] HDRI switched to: ${url}`);
    } catch (e) {
      console.warn('[renderer] HDRI switch failed:', e.message);
    }
  }

  // Register env-map change callback so light preset switches automatically swap the HDRI.
  lightFactory.onEnvMapChange((url) => _applyHdriUrl(url));

  // ---- Resize ----
  const resizeObs = new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(2, Math.round(r.width));
    const h = Math.max(2, Math.round(r.height));
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    markDirty();
  });
  resizeObs.observe(canvas);

  let running = true;
  // Match the unchecked PostFX UI by default. Building the composer is cheap,
  // but rendering through GTAO/Bloom/SMAA during IFC streaming is not.
  let useComposer = false;
  const clock = new THREE.Clock();

  // ---- Render-on-demand + progressive accumulation ----
  // Instead of rendering every frame at 60fps (wasteful when scene is static),
  // we use a dirty-flag system. When the camera moves, scene changes, or a
  // control fires, we mark the renderer as dirty and render for a few frames.
  // After settling (no change for ~200ms), we stop rendering to save GPU.
  // During the settling window, extra frames serve as implicit accumulation for
  // temporal effects (SSR convergence, AO stability).
  let _dirty = true;
  let _idleFrames = 0;
  const IDLE_SETTLE_FRAMES = 12; // render 12 extra frames after last change (~200ms)

  function markDirty() { _dirty = true; _idleFrames = 0; }

  // Hook into OrbitControls to detect camera movement
  controls.addEventListener("change", markDirty);

  function tick() {
    if (!running) return;
    const delta = clock.getDelta();
    if (fpsActive) {
      updateFPS(delta);
      _dirty = true; // FPS mode always renders
    } else {
      controls.update();
    }

    // Render only when dirty or within settle window
    if (_dirty || _idleFrames < IDLE_SETTLE_FRAMES) {
      _updateReflection(); // mirror pass before main compose
      if (useComposer) { composer.render(); }
      else { renderer.render(scene, camera); }
      if (!_dirty) { _idleFrames++; }
      _dirty = false;
    }

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---- IFC parsing (off main thread) ----
  // The web-ifc wasm and IFC StreamAllMeshes loop is CPU-heavy and previously
  // blocked the render loop. We push parsing into a module worker and only
  // do BufferGeometry assembly + material picking on the main thread, so the
  // composer keeps drawing at 60 fps while a 30 MB Plumbing IFC streams in.
  // ---- Materials + style factory ----


  const matFactory = new MaterialFactory({ onMaterialUpdate: markDirty });
  let materials = matFactory.materials;

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
      const mesh = buildMeshFromPayload(msg);
      if (mesh) {
        job.group.add(mesh);
        job.count++;
      }
    } else if (msg.type === "done") {
      pendingJobs.delete(msg.jobId);
      root.add(job.group);
      // Respect the current level filter for this newly-arrived group. The
      // system filter was already wired in loadIfc() when the group was
      // created, so all we need here is the level pass.
      applyLevelToGroup(job.group);
      markDirty();
      job.resolve({ count: job.count, group: job.group });
    } else if (msg.type === "error") {
      pendingJobs.delete(msg.jobId);
      job.reject(new Error(msg.message));
    }
  });

  function buildMeshFromPayload(msg) {
    if (!msg?.positions?.length || msg.positions.length < 9 || !msg?.indices?.length || msg.indices.length < 3) {
      return null;
    }
    const synthesizeUv = (positions, normals) => {
      if (!positions || positions.length < 9 || positions.length % 3 !== 0) return null;
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      const sizeX = Math.max(maxX - minX, 1e-4);
      const sizeY = Math.max(maxY - minY, 1e-4);
      const sizeZ = Math.max(maxZ - minZ, 1e-4);
      const uvs = new Float32Array((positions.length / 3) * 2);
      for (let i = 0, uv = 0; i < positions.length; i += 3, uv += 2) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        const nx = Math.abs(normals?.[i] ?? 0);
        const ny = Math.abs(normals?.[i + 1] ?? 0);
        const nz = Math.abs(normals?.[i + 2] ?? 1);
        if (nx >= ny && nx >= nz) {
          uvs[uv] = (z - minZ) / sizeZ;
          uvs[uv + 1] = (y - minY) / sizeY;
        } else if (ny >= nx && ny >= nz) {
          uvs[uv] = (x - minX) / sizeX;
          uvs[uv + 1] = (z - minZ) / sizeZ;
        } else {
          uvs[uv] = (x - minX) / sizeX;
          uvs[uv + 1] = (y - minY) / sizeY;
        }
      }
      return uvs;
    };
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(msg.positions, 3));
    bg.setAttribute("normal",   new THREE.BufferAttribute(msg.normals,   3));
    bg.setIndex(new THREE.BufferAttribute(msg.indices, 1));
    const isFurniture = msg.ifcType === 263784265;
    const uvs = msg.uvs || (isFurniture ? synthesizeUv(msg.positions, msg.normals) : null);
    if (uvs) {
      const uvAttr = new THREE.BufferAttribute(uvs, 2);
      bg.setAttribute("uv", uvAttr);
      bg.setAttribute("uv1", uvAttr);
      bg.setAttribute("uv2", uvAttr);
    }
    bg.computeBoundingBox();
    bg.computeBoundingSphere();
    const furnitureMeta = isFurniture && msg.furnitureMeta ? msg.furnitureMeta : null;
    const furnitureMaterialKey = isFurniture ? classifyFurnitureMaterial(furnitureMeta || {}) : null;
    let mat = pickMaterial(materials, msg.ifcType, furnitureMeta || (msg.expressID ?? 0));
    // The Duplex sample tags some IfcFurnishingElement geometry with a low
    // alpha colour. Treating that as real transparency makes sofas, beds and
    // cabinets look like ghosts, so keep semantic furniture materials fully
    // opaque and only honour source alpha for non-furniture helper geometry.
    if (!isFurniture && msg.color && msg.color.w !== undefined && msg.color.w < 0.95 && mat !== materials.window) {
      mat = mat.clone();
      mat.transparent = true;
      mat.opacity = Math.max(0.25, msg.color.w);
    }
    const mesh = new THREE.Mesh(bg, mat);
    mesh.userData.ifcType = msg.ifcType;
    mesh.userData.expressID = msg.expressID ?? null;
    mesh.userData.furnitureMaterialKey = furnitureMaterialKey;
    mesh.userData.furnitureName = furnitureMeta && furnitureMeta.name != null ? furnitureMeta.name : null;
    mesh.userData.furnitureObjectType = furnitureMeta && furnitureMeta.objectType != null ? furnitureMeta.objectType : null;
    mesh.userData.furnitureTag = furnitureMeta && furnitureMeta.tag != null ? furnitureMeta.tag : null;
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

  // ---- GLB / GLTF loader ----
  // Supports Draco-compressed geometry. DracoLoader decoder is resolved from
  // the same three/addons path used by the rest of the renderer, so no extra
  // CDN dependency is introduced.
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(
    new URL("../node_modules/three/examples/jsm/libs/draco/gltf/", import.meta.url).href
  );
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);

  /**
   * Load a .glb / .gltf file and add it to the scene.
   *
   * @param {string} url  — path relative to the page (or absolute URL)
   * @param {object} [opts]
   * @param {number[]} [opts.position]  — [x, y, z]  default [0,0,0]
   * @param {number[]} [opts.rotation]  — [rx, ry, rz] Euler radians, default [0,0,0]
   * @param {number[]} [opts.scale]     — [sx, sy, sz]  default [1,1,1]
   * @param {string}   [opts.name]      — group name for identification
   * @param {boolean}  [opts.castShadow]    default true
   * @param {boolean}  [opts.receiveShadow] default true
   * @param {boolean}  [opts.applyEnvMap]   replace material envMap with scene.environment, default true
   * @returns {Promise<{group: THREE.Group, scene: THREE.Group}>}
   */
  function loadGlb(url, opts = {}) {
    const absUrl = new URL(url, location.href).href;
    return new Promise((resolve, reject) => {
      gltfLoader.load(
        absUrl,
        (gltf) => {
          const group = new THREE.Group();
          group.name = opts.name || url.split('/').pop();

          if (opts.position) group.position.set(...opts.position);
          if (opts.rotation) group.rotation.set(...opts.rotation);
          if (opts.scale)    group.scale.set(...opts.scale);

          const doShadow     = opts.castShadow    ?? true;
          const doReceive    = opts.receiveShadow ?? true;
          const applyEnvMap  = opts.applyEnvMap   ?? true;

          gltf.scene.traverse((child) => {
            if (!child.isMesh) return;
            child.castShadow    = doShadow;
            child.receiveShadow = doReceive;
            // Wire in the HDR environment for correct PBR reflections
            if (applyEnvMap && scene.environment && child.material) {
              const mats = Array.isArray(child.material)
                ? child.material : [child.material];
              for (const mat of mats) {
                mat.envMap = scene.environment;
                mat.envMapIntensity = mat.envMapIntensity ?? 1.0;
                mat.needsUpdate = true;
              }
            }
          });

          group.add(gltf.scene);
          root.add(group);
          markDirty();
          resolve({ group, scene: gltf.scene });
        },
        undefined,
        (err) => reject(new Error(`loadGlb failed for "${url}": ${err.message || err}`))
      );
    });
  }

  /**
   * Remove a previously loaded GLB group by name or reference.
   * @param {string|THREE.Group} nameOrGroup
   */
  function removeGlb(nameOrGroup) {
    const target = typeof nameOrGroup === 'string'
      ? root.children.find((c) => c.name === nameOrGroup)
      : nameOrGroup;
    if (!target) return;
    target.traverse((n) => { n.geometry?.dispose?.(); });
    root.remove(target);
    markDirty();
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
      // Use AABB intersection (min/max) instead of centre-point so walls and
      // slabs that span the boundary between two floors stay visible in each
      // floor view. A 0.12 m tolerance prevents thin floor-slabs from hiding.
      const bb = obj.geometry?.boundingBox;
      if (!bb) {
        obj.visible = true;
        return;
      }
      obj.updateMatrixWorld(false);
      const worldMin = bb.min.clone().applyMatrix4(obj.matrixWorld);
      const worldMax = bb.max.clone().applyMatrix4(obj.matrixWorld);
      const yMin = Math.min(worldMin.y, worldMax.y);
      const yMax = Math.max(worldMin.y, worldMax.y);
      obj.visible = yMax >= min - 0.12 && yMin < max + 0.12;
      // Cache invalidated geometry centre won't be reused if we switch from
      // centre-point to intersection — clear the stale cache entry.
      delete obj.userData._heightY;
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

  function debugFurnitureMaterialAssignments() {
    const furnitureKeys = [
      "furniture",
      "furnitureBed",
      "furnitureHard",
      "furnitureTop",
      "furnitureDarkWood",
      "furnitureLightWood",
      "furnitureMetal"
    ];
    const stats = { totalFurniture: 0, matched: 0, mismatched: 0, byExpected: {} };
    root.traverse((obj) => {
      if (!obj.isMesh || obj.userData.ifcType !== 263784265) return;
      const expected = obj.userData.furnitureMaterialKey || "furnitureHard";
      const actual = furnitureKeys.find((key) => materials[key] === obj.material) || "unknown";
      const bucket = stats.byExpected[expected] || (stats.byExpected[expected] = {
        total: 0,
        matched: 0,
        mismatched: 0,
        actual: {},
        samples: []
      });
      stats.totalFurniture++;
      bucket.total++;
      const sampleLabel = [obj.userData.furnitureName, obj.userData.furnitureObjectType]
        .filter(Boolean)
        .join(" · ");
      if (sampleLabel && bucket.samples.length < 10 && !bucket.samples.includes(sampleLabel)) {
        bucket.samples.push(sampleLabel);
      }
      bucket.actual[actual] = (bucket.actual[actual] || 0) + 1;
      if (actual === expected) {
        stats.matched++;
        bucket.matched++;
      } else {
        stats.mismatched++;
        bucket.mismatched++;
      }
    });
    return stats;
  }

  function debugFurnitureMaterialLooks() {
    const surfaceKeys = [
      "furniture",
      "furnitureBed",
      "furnitureHard",
      "furnitureTop",
      "furnitureDarkWood",
      "furnitureLightWood",
      "furnitureMetal"
    ];
    const result = { style: matFactory.activeStyle, surfaces: {} };
    surfaceKeys.forEach((key) => {
      const mat = materials[key];
      result.surfaces[key] = mat ? {
        color: mat.color ? `#${mat.color.getHexString()}` : null,
        roughness: Number.isFinite(mat.roughness) ? +mat.roughness.toFixed(3) : null,
        clearcoat: Number.isFinite(mat.clearcoat) ? +mat.clearcoat.toFixed(3) : null,
        clearcoatRoughness: Number.isFinite(mat.clearcoatRoughness) ? +mat.clearcoatRoughness.toFixed(3) : null,
        sheen: Number.isFinite(mat.sheen) ? +mat.sheen.toFixed(3) : null,
        sheenColor: mat.sheenColor ? `#${mat.sheenColor.getHexString()}` : null,
        sheenRoughness: Number.isFinite(mat.sheenRoughness) ? +mat.sheenRoughness.toFixed(3) : null,
        specularIntensity: Number.isFinite(mat.specularIntensity) ? +mat.specularIntensity.toFixed(3) : null,
        envMapIntensity: Number.isFinite(mat.envMapIntensity) ? +mat.envMapIntensity.toFixed(3) : null,
        normalScale: mat.normalScale?.isVector2
          ? [
              +mat.normalScale.x.toFixed(3),
              +mat.normalScale.y.toFixed(3)
            ]
          : null,
        mapRepeat: mat.map?.repeat
          ? [
              +mat.map.repeat.x.toFixed(3),
              +mat.map.repeat.y.toFixed(3)
            ]
          : null,
        normalMapRepeat: mat.normalMap?.repeat
          ? [
              +mat.normalMap.repeat.x.toFixed(3),
              +mat.normalMap.repeat.y.toFixed(3)
            ]
          : null,
        roughnessMapRepeat: mat.roughnessMap?.repeat
          ? [
              +mat.roughnessMap.repeat.x.toFixed(3),
              +mat.roughnessMap.repeat.y.toFixed(3)
            ]
          : null,
        hasMap: !!mat.map,
        hasNormalMap: !!mat.normalMap,
        hasRoughnessMap: !!mat.roughnessMap
      } : null;
    });
    return result;
  }

  function debugFurnitureGeometryStats() {
    const stats = {
      total: 0,
      withUv: 0,
      withUv1: 0,
      withUv2: 0,
      missingUvSamples: []
    };
    root.traverse((obj) => {
      if (!obj.isMesh || obj.userData.ifcType !== 263784265) return;
      stats.total++;
      const hasUv = !!obj.geometry?.getAttribute?.("uv");
      const hasUv1 = !!obj.geometry?.getAttribute?.("uv1");
      const hasUv2 = !!obj.geometry?.getAttribute?.("uv2");
      if (hasUv) stats.withUv++;
      if (hasUv1) stats.withUv1++;
      if (hasUv2) stats.withUv2++;
      if (!hasUv && stats.missingUvSamples.length < 8) {
        stats.missingUvSamples.push({
          expressID: obj.userData.expressID ?? null,
          name: obj.userData.furnitureName ?? null,
          objectType: obj.userData.furnitureObjectType ?? null,
          tag: obj.userData.furnitureTag ?? null,
          materialKey: obj.userData.furnitureMaterialKey ?? null,
          vertexCount: obj.geometry?.getAttribute?.("position")?.count ?? 0,
          indexCount: obj.geometry?.index?.count ?? 0,
          bbox: obj.geometry?.boundingBox ? {
            min: {
              x: +obj.geometry.boundingBox.min.x.toFixed(3),
              y: +obj.geometry.boundingBox.min.y.toFixed(3),
              z: +obj.geometry.boundingBox.min.z.toFixed(3)
            },
            max: {
              x: +obj.geometry.boundingBox.max.x.toFixed(3),
              y: +obj.geometry.boundingBox.max.y.toFixed(3),
              z: +obj.geometry.boundingBox.max.z.toFixed(3)
            }
          } : null
        });
      }
    });
    return stats;
  }

  function debugFurnitureMaterialStateStats() {
    const stats = {
      total: 0,
      transparent: 0,
      lowOpacity: 0,
      bySide: { front: 0, back: 0, double: 0, other: 0 },
      negativeDeterminant: 0,
      failingSamples: []
    };
    root.traverse((obj) => {
      if (!obj.isMesh || obj.userData.ifcType !== 263784265) return;
      stats.total++;
      obj.updateMatrixWorld(false);
      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      const opacity = Number.isFinite(mat?.opacity) ? +mat.opacity.toFixed(3) : 1;
      const transparent = !!mat?.transparent;
      if (transparent) stats.transparent++;
      if (opacity < 0.99) stats.lowOpacity++;
      if (mat?.side === THREE.FrontSide) stats.bySide.front++;
      else if (mat?.side === THREE.BackSide) stats.bySide.back++;
      else if (mat?.side === THREE.DoubleSide) stats.bySide.double++;
      else stats.bySide.other++;
      if (obj.matrixWorld.determinant() < 0) stats.negativeDeterminant++;
      if ((transparent || opacity < 0.99) && stats.failingSamples.length < 8) {
        stats.failingSamples.push({
          expressID: obj.userData.expressID ?? null,
          name: obj.userData.furnitureName ?? null,
          objectType: obj.userData.furnitureObjectType ?? null,
          tag: obj.userData.furnitureTag ?? null,
          materialKey: obj.userData.furnitureMaterialKey ?? null,
          transparent,
          opacity,
          side: mat?.side === THREE.FrontSide
            ? "front"
            : mat?.side === THREE.BackSide
              ? "back"
              : mat?.side === THREE.DoubleSide
                ? "double"
                : String(mat?.side ?? "unknown")
        });
      }
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
    // Adaptive shadow frustum: tighten to scene bounding box + 20% padding.
    // This maximizes shadow map resolution utilization rather than covering
    // a needlessly large area.
    const shadowPad = maxDim * 0.2;
    Object.assign(sunLight.shadow.camera, {
      left: -(size.x / 2 + shadowPad),
      right: size.x / 2 + shadowPad,
      top: size.z / 2 + shadowPad,
      bottom: -(size.z / 2 + shadowPad),
      near: 0.5,
      far: Math.max(size.y * 3, maxDim * 2)
    });
    sunLight.shadow.camera.updateProjectionMatrix();
    sunLight.position.copy(sun).multiplyScalar(maxDim * 1.6).add(center);
    sunLight.target.position.copy(center);
    sunLight.target.updateMatrixWorld();
    markDirty();
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
    markDirty();
  }

  function clearAll() {
    // Reject any in-flight worker jobs so awaiters don't hang.
    pendingJobs.forEach((job) => job.reject(new Error("renderer cleared")));
    pendingJobs.clear();
    while (root.children.length) {
      const c = root.children.pop();
      c.traverse?.((n) => { n.geometry?.dispose?.(); });
    }
    markDirty();
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

  // ---- Camera tour (GSAP) ----
  const cameraTour = new CameraTour(camera, controls, markDirty);

  /**
   * Run one of the built-in scene tours or a custom waypoint array.
   * @param {'overview'|'groundFloor'|'upperFloor'|'details'|Array} tourOrName
   * @param {Object} [opts]  — forwarded to CameraTour.autoTour()
   */
  function startTour(tourOrName, opts = {}) {
    const wps = typeof tourOrName === 'string' ? SCENE_TOURS[tourOrName] : tourOrName;
    if (!wps) { console.warn(`[renderer] Unknown tour "${tourOrName}"`); return; }
    cameraTour.autoTour(wps, opts);
  }

  function stopTour() { cameraTour.stop(); }
  function setBloom(v) { bloom.strength = v; markDirty(); }
  function setExposure(v) { renderer.toneMappingExposure = Math.max(0.1, v); markDirty(); }
  function setContactShadowOpacity(v) {
    csPlane.material.opacity = Math.max(0, Math.min(1, v));
    csPlane.visible = v > 0.001;
    markDirty();
  }
  function setFloorReflection(opacity, roughness) {
    reflFloorMat.uniforms.opacity.value = Math.max(0, Math.min(0.6, opacity ?? 0.08));
    if (roughness != null) reflRoughness = Math.max(0, Math.min(1, roughness));
    reflFloorMat.uniforms.roughness.value = reflRoughness;
    floorReflector.visible = (opacity ?? 0.08) > 0.001;
    reflectorEnabled = floorReflector.visible;
    markDirty();
  }
  function setChromaticAberration(strength) {
    colorGrading.uniforms.chromaticAberration.value = Math.max(0, Math.min(0.02, strength));
    markDirty();
  }
  function setPostProcessing(enabled) { useComposer = !!enabled; markDirty(); }
  function setEnvironmentIntensity(v) { scene.environmentIntensity = Math.max(0, v); markDirty(); }
  function setGtaoIntensity(v) { gtao.blendIntensity = Math.max(0, Math.min(2, v)); markDirty(); }
  function setVignette(offset, darkness) {
    colorGrading.uniforms.vignetteOffset.value = offset ?? 1.0;
    colorGrading.uniforms.vignetteDarkness.value = darkness ?? 0.9;
  }
  function setColorGrading({ contrast, saturation, temperature } = {}) {
    if (contrast != null) colorGrading.uniforms.contrast.value = contrast;
    if (saturation != null) colorGrading.uniforms.saturation.value = saturation;
    if (temperature != null) colorGrading.uniforms.temperature.value = temperature;
    markDirty();
  }
  function setSSR(enabled, options = {}) {
    ssrEnabled = !!enabled;
    ssrPass.enabled = ssrEnabled;
    if (options.opacity != null) ssrPass.opacity = options.opacity;
    if (options.maxDistance != null) ssrPass.maxDistance = options.maxDistance;
    if (options.thickness != null) ssrPass.thickness = options.thickness;
    markDirty();
  }

  // ---- Sun position control ----
  // Updates Sky shader sun direction + directional light + re-generates IBL.
  function setSunPosition(elevationDeg, azimuthDeg) {
    const p = THREE.MathUtils.degToRad(90 - elevationDeg);
    const t = THREE.MathUtils.degToRad(azimuthDeg);
    sun.setFromSphericalCoords(1, p, t);
    skyU["sunPosition"].value.copy(sun);
    // Regenerate IBL from updated sky only if no HDR envMap is active. When
    // the HDR is loaded, it provides superior indoor reflections and should
    // not be overwritten by a sky-derived environment.
    if (!hdrEnvMap) {
      const newEnv = pmrem.fromScene(scene, 0.04).texture;
      if (scene.environment) scene.environment.dispose();
      scene.environment = newEnv;
    }
    // Move directional light to match sun
    const fitDist = sunLight.position.length() || 80;
    sunLight.position.copy(sun).multiplyScalar(fitDist);
    markDirty();
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
          furnitureMaterialKey: hit.object.userData.furnitureMaterialKey || null,
          furnitureName: hit.object.userData.furnitureName || null,
          furnitureObjectType: hit.object.userData.furnitureObjectType || null,
          furnitureTag: hit.object.userData.furnitureTag || null,
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
    markDirty();
  }

  /**
   * Apply a style preset to all materials in the scene.
   * @param {'japandi'|'luxury'|'volcanic'|'smart'} styleName
   */
  function setStyle(styleName, options = {}) {
    const newMats = matFactory.apply(styleName, options);
    // Patch every mesh in root so live geometry reflects the new materials
    root.traverse((obj) => {
      if (!obj.isMesh || obj.userData.ifcType == null) return;
      const furnitureRef = obj.userData.furnitureMaterialKey
        || (obj.userData.ifcType === 263784265
          ? {
            furnitureMaterialKey: obj.userData.furnitureMaterialKey,
            name: obj.userData.furnitureName,
            objectType: obj.userData.furnitureObjectType,
            tag: obj.userData.furnitureTag,
            expressID: obj.userData.expressID ?? 0
          }
          : (obj.userData.expressID ?? 0));
      const fresh = pickMaterial(newMats, obj.userData.ifcType, furnitureRef);
      if (fresh) obj.material = fresh;
    });
    // Rebind the live materials map so future loadIfc calls also pick up the style.
    materials = newMats;
    markDirty();
  }

  /**
   * Apply a lighting preset.
   * @param {'daylight'|'night'|'showroom'} presetName
   */
  function setLightPreset(presetName) {
    lightFactory.apply(presetName);
    markDirty();
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
    setFloorReflection,
    setChromaticAberration,
    setEnvironmentIntensity,
    setGtaoIntensity,
    setVignette,
    setColorGrading,
    setSSR,
    setStyle,
    getActiveStyle:       () => matFactory.activeStyle,
    setLightPreset,
    getActiveLightPreset: () => lightFactory.activePreset,
    loadGlb,
    removeGlb,
    startTour,
    stopTour,
    isTourRunning: () => cameraTour.isRunning,
    loadHdri: (url) => _applyHdriUrl(url),
    setSystemVisibility,
    setLevelFilter,
    getKnownSystems,
    debugVisibilityStats,
    debugFurnitureMaterialAssignments,
    debugFurnitureMaterialLooks,
    debugFurnitureGeometryStats,
    debugFurnitureMaterialStateStats,
    debugGroupBboxes,
    setPostProcessing,
    setSunPosition,
    setTimeOfDay,
    flyToInterior,
    enterFPS,
    exitFPS,
    isFPS: () => fpsActive,
    markDirty,
    onSelect,
    clearSelection,
    dispose() {
      running = false;
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      resizeObs.disconnect();
      controls.removeEventListener("change", markDirty);
      clearAll();
      try { fpsControls.dispose(); } catch {}
      cameraTour.stop();
      try { ifcWorker.terminate(); } catch {}
      workerDead = true;
      try { csTarget.dispose(); csTargetBlur.dispose(); } catch {}
      try { reflRT.dispose(); reflBlurRT.dispose(); } catch {}
      try { reflHBlurMat.dispose(); reflVBlurMat.dispose(); reflFloorMat.dispose(); reflFloorGeom.dispose(); } catch {}
      try { csHBlur.dispose(); csVBlur.dispose(); csDepthMaterial.dispose(); } catch {}
      try { matFactory.dispose(); } catch {}
      try { dracoLoader.dispose(); } catch {}
      composer.dispose();
      renderer.dispose();
      pmrem.dispose();
    }
  };
}
