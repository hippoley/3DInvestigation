// High-end IFC renderer: web-ifc geometry + HDR environment + PBR
// procedural textures + full post-processing pipeline (GTAO/Bloom/SMAA).
// Default env: assets/hdri/glasshouse_interior_4k.exr for indoor reflections.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
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
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { ColorGradingShader } from "./bp3d-color-grading.js";
import { classifyFurnitureMaterial, pickMaterial } from "./bp3d-materials.js";
import { MaterialFactory } from "./bp3d-material-factory.js";
import { LightFactory } from "./bp3d-light-factory.js";
import { CameraTour, SCENE_TOURS } from "./bp3d-camera-tour.js?v=chuangsha-product-tour-20260624j";

export async function createRealRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;

  const scene = new THREE.Scene();
  // Reduced fog density for better indoor visibility (was 0.012).
  scene.fog = new THREE.FogExp2(0xf7f5ef, 0.0035);

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
  scene.environmentIntensity = 0.78; // warm daylight without clipping pale interiors
  scene.background = new THREE.Color(0xf8f7f2);

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
  const sunLight = new THREE.DirectionalLight(0xffefd8, 2.28);
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

  const fill = new THREE.DirectionalLight(0xfff2e2, 0.82);
  fill.position.set(-15, 10, 10);
  scene.add(fill);
  // Hemisphere light provides essential indoor fill (sky → ground gradient).
  const hemi = new THREE.HemisphereLight(0xfff7ee, 0xcdbb9d, 0.76);
  scene.add(hemi);
  // Soft ambient makes sure no crevice is pitch-black indoors.
  const ambient = new THREE.AmbientLight(0xfff4e8, 0.18);
  scene.add(ambient);

  // ---- Ground (procedural, receives shadows) ----
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(180, 96),
    new THREE.MeshStandardMaterial({ color: 0xf1eee6, roughness: 0.96, metalness: 0 })
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
  gtao.updateGtaoMaterial({ radius: 0.44, distanceExponent: 2, thickness: 1.28, scale: 0.76, samples: 16 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 16 });
  gtao.blendIntensity = 0.62;
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
  const bloom = new UnrealBloomPass(new THREE.Vector2(1024, 1024), 0.0, 0.32, 1.08);
  composer.addPass(bloom);
  composer.addPass(new SMAAPass(1024, 1024));
  // Color grading: vignette + warm temperature + contrast for archviz photo feel
  const colorGrading = new ShaderPass(ColorGradingShader);
  if (!colorGrading.uniforms.resolution) colorGrading.uniforms.resolution = { value: new THREE.Vector2(1, 1) };
  else if (!colorGrading.uniforms.resolution.value || typeof colorGrading.uniforms.resolution.value.set !== "function") {
    colorGrading.uniforms.resolution.value = new THREE.Vector2(1, 1);
  }
  composer.addPass(colorGrading);
  composer.addPass(new OutputPass());

  // ---- Light factory (preset templates) ----
  const lightFactory = new LightFactory({ sunLight, fill, hemi, ambient, scene, renderer, colorGrading });
  // Default preset matches the hard-coded initial values already set above, so no
  // re-application is needed on startup — but we track the name for getActivePreset().
  lightFactory._activePreset = 'indoor';

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
      updateReplacementMaterialEnvironment();
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
    if (!colorGrading.uniforms.resolution) colorGrading.uniforms.resolution = { value: new THREE.Vector2(w, h) };
    else if (!colorGrading.uniforms.resolution.value || typeof colorGrading.uniforms.resolution.value.set !== "function") {
      colorGrading.uniforms.resolution.value = new THREE.Vector2(w, h);
    } else {
      colorGrading.uniforms.resolution.value.set(w, h);
    }
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
  const replacementTextureCache = new Map();
  let replacementMaterialSet = null;
  let replacementMaterialStyle = null;

  const ifcWorker = new Worker(new URL("./bp3d-ifc-worker.js?v=window-meta-20260623a", import.meta.url), { type: "module" });
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
    const isWindow = msg.ifcType === 3304561284 || msg.ifcType === 486154966;
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
    const windowMeta = isWindow && msg.windowMeta ? msg.windowMeta : null;
    let furnitureMaterialKey = isFurniture ? classifyFurnitureMaterial(furnitureMeta || {}) : null;
    if (isFurniture && furnitureMaterialKey !== "furnitureSheer" && looksLikeWindowSheer(bg)) {
      furnitureMaterialKey = "furnitureSheer";
    }
    let mat = pickMaterial(materials, msg.ifcType, furnitureMeta || (msg.expressID ?? 0));
    if (isFurniture && furnitureMaterialKey && materials[furnitureMaterialKey]) {
      mat = materials[furnitureMaterialKey];
    }
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
    mesh.userData.windowName = windowMeta && windowMeta.name != null ? windowMeta.name : null;
    mesh.userData.windowObjectType = windowMeta && windowMeta.objectType != null ? windowMeta.objectType : null;
    mesh.userData.windowTag = windowMeta && windowMeta.tag != null ? windowMeta.tag : null;
    mesh.userData.windowGlobalId = windowMeta && windowMeta.globalId != null ? windowMeta.globalId : null;
    mesh.userData.windowOverallHeight = windowMeta && windowMeta.overallHeight != null ? windowMeta.overallHeight : null;
    mesh.userData.windowOverallWidth = windowMeta && windowMeta.overallWidth != null ? windowMeta.overallWidth : null;
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

  function looksLikeWindowSheer(geometry) {
    const bb = geometry?.boundingBox;
    if (!bb) return false;
    const sx = bb.max.x - bb.min.x;
    const sy = bb.max.y - bb.min.y;
    const sz = bb.max.z - bb.min.z;
    const dims = [sx, sy, sz].sort((a, b) => a - b);
    const thin = dims[0] < 0.035;
    const tall = sy > 1.45;
    const curtainWidth = Math.max(sx, sz) > 0.65;
    const broadSheet = dims[2] / Math.max(dims[0], 0.001) > 35;
    return thin && tall && curtainWidth && broadSheet;
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

  // ---- Semantic furniture replacement ----
  // jiaju1.glb is treated as a local furniture asset library. Named GLB nodes
  // are classified once, then cloned and fitted into IFC furniture bounding
  // boxes by semantic category.
  const replacementLibraryCache = new Map();
  const windowAssetCache = new Map();
  const replacementGroups = new Set();
  const replacedOriginals = new Set();
  const windowReplacementGroups = new Set();
  const windowReplacedOriginals = new Set();
  let chuangshaProductCache = null;
  let chuangshaMaterialSet = null;
  const WALL_REPLACEMENT_IFC_TYPES = new Set([
    2391406946,  // IfcWall
    3512223829,  // IfcWallStandardCase
    3495092785   // IfcCurtainWall
  ]);

  function normaliseSemanticText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[():/_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function textHasAny(text, parts) {
    return parts.some((part) => text.includes(part));
  }

  function classifyJiajuAssetName(name = "") {
    const text = normaliseSemanticText(name);
    if (textHasAny(text, ["shafa", "sofa", "couch"])) return "sofa";
    if (textHasAny(text, ["chuang", "bed"])) return "bed";
    if (textHasAny(text, ["yizi", "chair", "stool"])) return "chair";
    if (textHasAny(text, ["zhuo", "table", "desk"])) return "table";
    return null;
  }

  function sceneFurnitureText(obj) {
    return normaliseSemanticText([
      obj.userData.furnitureName,
      obj.userData.furnitureObjectType,
      obj.userData.furnitureTag,
      obj.userData.furnitureMaterialKey
    ].filter(Boolean).join(" "));
  }

  function classifySceneFurnitureForReplacement(obj) {
    if (!obj?.isMesh || obj.userData.ifcType !== 263784265) return null;
    const text = sceneFurnitureText(obj);
    if (!text) return null;
    if (textHasAny(text, ["curtain", "sheer", "voile", "blind", "shade", "screen"])) return null;
    if (textHasAny(text, ["pillow", "duvet", "blanket", "throw cushion"])) return null;
    if (textHasAny(text, ["bed frame", "mattress", "headboard", "bed"])) return "bed";
    if (textHasAny(text, ["chair", "armchair", "lounge chair", "stool", "bench"])) return "chair";
    if (textHasAny(text, ["sofa", "couch", "loveseat", "settee", "chaise"])) return "sofa";
    if (textHasAny(text, ["dining table", "coffee table", "side table", "table", "desk", "nightstand"])) return "table";
    return null;
  }

  const BED_ACCESSORY_HIDE_WORDS = [
    "shelf",
    "shelving",
    "bookshelf",
    "bookcase",
    "rack",
    "storage",
    "cabinet",
    "casework",
    "locker",
    "wardrobe",
    "closet",
    "wall unit",
    "built in",
    "built-in"
  ];

  const BED_ACCESSORY_KEEP_WORDS = [
    "nightstand",
    "side table",
    "table",
    "desk",
    "chair",
    "stool",
    "bench",
    "sofa",
    "couch",
    "mattress",
    "pillow",
    "duvet",
    "blanket",
    "bed"
  ];

  function footprintDistance(a, b) {
    const dx = a.max.x < b.min.x ? b.min.x - a.max.x : b.max.x < a.min.x ? a.min.x - b.max.x : 0;
    const dz = a.max.z < b.min.z ? b.min.z - a.max.z : b.max.z < a.min.z ? a.min.z - b.max.z : 0;
    return Math.hypot(dx, dz);
  }

  function materialLooksTransparent(mat) {
    const mats = Array.isArray(mat) ? mat : [mat];
    return mats.some((item) => !!item?.transparent || (Number.isFinite(item?.opacity) && item.opacity < 0.98));
  }

  function shouldHideBedAccessory(obj, box, bedTargets, bedTargetMeshSet) {
    if (!obj?.isMesh || obj.userData.ifcType !== 263784265) return null;
    if (obj.userData._semanticReplacementHidden || bedTargetMeshSet.has(obj)) return null;
    const text = sceneFurnitureText(obj);
    if (!text) return null;
    if (textHasAny(text, BED_ACCESSORY_KEEP_WORDS)) return null;
    const semanticShelf = textHasAny(text, BED_ACCESSORY_HIDE_WORDS);
    const transparentFurniture = obj.userData.furnitureMaterialKey === "furnitureSheer" || materialLooksTransparent(obj.material);
    if (!semanticShelf && !transparentFurniture) return null;

    const size = box.getSize(new THREE.Vector3());
    if (size.y < 0.05 || Math.max(size.x, size.z) < 0.12) return null;

    for (const target of bedTargets) {
      const bedBox = target.box;
      const bedSize = bedBox.getSize(new THREE.Vector3());
      const maxBedFootprint = Math.max(bedSize.x, bedSize.z);
      const distance = footprintDistance(box, bedBox);
      const nearBed = distance <= Math.max(0.42, Math.min(0.85, maxBedFootprint * 0.34));
      const inflated = bedBox.clone().expandByVector(new THREE.Vector3(0.38, 1.55, 0.38));
      inflated.min.y = Math.min(inflated.min.y, bedBox.min.y - 0.05);
      inflated.max.y = Math.max(inflated.max.y, bedBox.max.y + 1.55);
      if (!nearBed && !inflated.intersectsBox(box)) continue;

      const aboveMattress = box.max.y >= bedBox.min.y + 0.48;
      const notFloorOnly = box.max.y >= bedBox.min.y + 0.72 || size.y >= 0.7 || transparentFurniture;
      const notHugeWardrobe = !(semanticShelf && size.y > 2.35 && distance > 0.18);
      if (aboveMattress && notFloorOnly && notHugeWardrobe) {
        return {
          bedExpressID: target.expressID ?? null,
          distance: +distance.toFixed(3),
          semanticShelf,
          transparentFurniture
        };
      }
    }
    return null;
  }

  function finiteBox(box) {
    return Number.isFinite(box.min.x) && Number.isFinite(box.max.x);
  }

  function boxSnapshot(box) {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    return {
      center: { x: +center.x.toFixed(3), y: +center.y.toFixed(3), z: +center.z.toFixed(3) },
      size: { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) },
      min: { x: +box.min.x.toFixed(3), y: +box.min.y.toFixed(3), z: +box.min.z.toFixed(3) },
      max: { x: +box.max.x.toFixed(3), y: +box.max.y.toFixed(3), z: +box.max.z.toFixed(3) }
    };
  }

  function directionSnapshot(v) {
    if (!v) return null;
    return { x: +v.x.toFixed(3), z: +v.z.toFixed(3) };
  }

  function percentile(values, p) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p)));
    return sorted[index];
  }

  function collectSampledWorldPoints(objects, maxPerMesh = 3500, maxTotal = 24000) {
    const roots = Array.isArray(objects) ? objects : [objects];
    const points = [];
    const point = new THREE.Vector3();
    roots.forEach((rootObj) => {
      if (!rootObj?.traverse || points.length >= maxTotal) return;
      rootObj.traverse((obj) => {
        const position = obj.isMesh ? obj.geometry?.getAttribute?.("position") : null;
        if (!position || points.length >= maxTotal) return;
        obj.updateMatrixWorld(true);
        const remaining = maxTotal - points.length;
        const stride = Math.max(1, Math.ceil(position.count / Math.min(maxPerMesh, remaining)));
        for (let i = 0; i < position.count && points.length < maxTotal; i += stride) {
          point.fromBufferAttribute(position, i).applyMatrix4(obj.matrixWorld);
          points.push(point.clone());
        }
      });
    });
    return points;
  }

  function raisedEndStats(points, floorY, height) {
    if (!points.length) return null;
    const ys = points.map((point) => point.y);
    const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
    const highCut = floorY + height * 0.68;
    const highRatio = ys.filter((y) => y >= highCut).length / ys.length;
    const p90 = percentile(ys, 0.9);
    const p97 = percentile(ys, 0.97);
    return {
      count: ys.length,
      meanY,
      highRatio,
      p90,
      p97,
      score: p90 * 0.35 + p97 * 0.35 + meanY * 0.12 + highRatio * height * 0.75
    };
  }

  function inferRaisedEndDirection(objects, referenceBox = null, options = {}) {
    const points = collectSampledWorldPoints(
      objects,
      options.maxPerMesh ?? 3500,
      options.maxTotal ?? 24000
    );
    if (points.length < 12) return null;

    const box = referenceBox?.clone?.() || new THREE.Box3().setFromPoints(points);
    if (!finiteBox(box)) return null;
    const size = box.getSize(new THREE.Vector3());
    const height = Math.max(size.y, 0.001);
    const longestHorizontal = Math.max(size.x, size.z, 0.001);
    const axes = [
      { name: "x", length: size.x, positive: new THREE.Vector3(1, 0, 0) },
      { name: "z", length: size.z, positive: new THREE.Vector3(0, 0, 1) }
    ];
    let best = null;

    axes.forEach((axis) => {
      if (axis.length < 0.18) return;
      const endDepth = Math.max(0.08, axis.length * (options.endFraction ?? 0.24));
      const minEdge = box.min[axis.name] + endDepth;
      const maxEdge = box.max[axis.name] - endDepth;
      const negativeEnd = points.filter((point) => point[axis.name] <= minEdge);
      const positiveEnd = points.filter((point) => point[axis.name] >= maxEdge);
      if (negativeEnd.length < 6 || positiveEnd.length < 6) return;
      const negative = raisedEndStats(negativeEnd, box.min.y, height);
      const positive = raisedEndStats(positiveEnd, box.min.y, height);
      if (!negative || !positive) return;
      const delta = positive.score - negative.score;
      const axisBias = axis.length / longestHorizontal;
      const confidence = Math.abs(delta) / height * axisBias;
      const candidate = {
        axis: axis.name,
        sign: delta >= 0 ? 1 : -1,
        score: Math.abs(delta) * axisBias,
        confidence,
        positiveScore: positive.score,
        negativeScore: negative.score
      };
      if (!best || candidate.score > best.score) best = candidate;
    });

    if (!best || best.confidence < (options.minConfidence ?? 0.045)) return null;
    const direction = best.axis === "x"
      ? new THREE.Vector3(best.sign, 0, 0)
      : new THREE.Vector3(0, 0, best.sign);
    return {
      direction,
      axis: best.axis,
      sign: best.sign,
      confidence: +best.confidence.toFixed(3),
      positiveScore: +best.positiveScore.toFixed(3),
      negativeScore: +best.negativeScore.toFixed(3)
    };
  }

  function pointToBoxFootprintDistance(point, box) {
    const dx = point.x < box.min.x ? box.min.x - point.x : point.x > box.max.x ? point.x - box.max.x : 0;
    const dz = point.z < box.min.z ? box.min.z - point.z : point.z > box.max.z ? point.z - box.max.z : 0;
    return Math.hypot(dx, dz);
  }

  function collectFurnitureReplacementWallBoxes() {
    const walls = [];
    root.traverse((obj) => {
      if (!obj.isMesh || !WALL_REPLACEMENT_IFC_TYPES.has(obj.userData.ifcType)) return;
      const box = new THREE.Box3().setFromObject(obj);
      if (!finiteBox(box)) return;
      const size = box.getSize(new THREE.Vector3());
      if (size.y < 0.45 || Math.max(size.x, size.z) < 0.35) return;
      walls.push({
        box: box.clone(),
        center: box.getCenter(new THREE.Vector3()),
        expressID: obj.userData.expressID ?? null
      });
    });
    return walls;
  }

  function wallOverlapsBedHeight(wall, targetBox) {
    return wall.box.max.y >= targetBox.min.y - 0.18 && wall.box.min.y <= targetBox.max.y + 1.6;
  }

  function nearestWallAtBedEnd(targetBox, direction, wallBoxes, strict = true) {
    const center = targetBox.getCenter(new THREE.Vector3());
    const size = targetBox.getSize(new THREE.Vector3());
    const dir = direction.clone();
    dir.y = 0;
    if (dir.lengthSq() < 0.001) return { distance: Infinity, wall: null };
    dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const halfLength = (Math.abs(dir.x) * size.x + Math.abs(dir.z) * size.z) * 0.5;
    const halfWidth = (Math.abs(dir.z) * size.x + Math.abs(dir.x) * size.z) * 0.5;
    const endPoint = center.clone().addScaledVector(dir, halfLength);
    let best = { distance: Infinity, wall: null };

    wallBoxes.forEach((wall) => {
      if (!wallOverlapsBedHeight(wall, targetBox)) return;
      const rel = wall.center.clone().sub(center);
      const along = rel.dot(dir);
      const lateral = Math.abs(rel.dot(side));
      const distance = pointToBoxFootprintDistance(endPoint, wall.box);
      if (strict) {
        const inFrontOfEnd = along >= halfLength * 0.2 || distance < 0.35;
        const plausiblyAcrossEnd = lateral <= halfWidth + Math.max(0.8, halfWidth * 0.55) || distance < 0.7;
        if (!inFrontOfEnd || !plausiblyAcrossEnd) return;
      }
      const score = distance + Math.max(0, halfLength * 0.2 - along) * 0.04;
      if (score < best.distance) best = { distance: score, wall };
    });

    return best;
  }

  function chooseBedHeadWallAlignment(targetBox, baseHeadDirection, wallBoxes, options = {}) {
    if (!wallBoxes?.length) return null;
    const targetSize = targetBox.getSize(new THREE.Vector3());
    const maxWallDistance = options.bedWallMaxDistance
      ?? Math.max(0.65, Math.min(1.8, Math.max(targetSize.x, targetSize.z) * 0.65));
    const keepStrict = nearestWallAtBedEnd(targetBox, baseHeadDirection, wallBoxes, true);
    const flipStrict = nearestWallAtBedEnd(targetBox, baseHeadDirection.clone().multiplyScalar(-1), wallBoxes, true);
    const keep = Number.isFinite(keepStrict.distance)
      ? keepStrict
      : nearestWallAtBedEnd(targetBox, baseHeadDirection, wallBoxes, false);
    const flip = Number.isFinite(flipStrict.distance)
      ? flipStrict
      : nearestWallAtBedEnd(targetBox, baseHeadDirection.clone().multiplyScalar(-1), wallBoxes, false);
    if (!Number.isFinite(keep.distance) && !Number.isFinite(flip.distance)) return null;
    if (Math.min(keep.distance, flip.distance) > maxWallDistance) return null;

    const margin = options.bedWallMargin ?? 0.12;
    if (Math.abs(keep.distance - flip.distance) <= margin) {
      return {
        source: "wall",
        shouldFlip: false,
        clear: false,
        keepDistance: +keep.distance.toFixed(3),
        flipDistance: +flip.distance.toFixed(3)
      };
    }
    return {
      source: "wall",
      shouldFlip: flip.distance < keep.distance,
      clear: true,
      keepDistance: +keep.distance.toFixed(3),
      flipDistance: +flip.distance.toFixed(3),
      wallExpressID: (flip.distance < keep.distance ? flip.wall : keep.wall)?.expressID ?? null
    };
  }

  function chooseBedHeadOriginalAlignment(target, baseHeadDirection) {
    if (!target?.meshes?.length) return null;
    const inferred = inferRaisedEndDirection(target.meshes, target.box, {
      maxPerMesh: 2200,
      maxTotal: 18000,
      minConfidence: 0.055
    });
    if (!inferred) return null;
    const targetDirection = inferred.direction.clone().normalize();
    return {
      source: "original-bed-geometry",
      shouldFlip: baseHeadDirection.dot(targetDirection) < 0,
      clear: true,
      targetHeadDirection: directionSnapshot(targetDirection),
      confidence: inferred.confidence
    };
  }

  function rotateHorizontalDirection(direction, rotationY) {
    const v = direction?.clone?.();
    if (!v) return null;
    v.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
    v.y = 0;
    return v.lengthSq() > 0.001 ? v.normalize() : null;
  }

  function bedWallDistanceLimit(targetSize, options = {}) {
    return options.bedWallMaxDistance
      ?? Math.max(0.75, Math.min(2.2, Math.max(targetSize.x, targetSize.z) * 0.82));
  }

  function inferTargetBedHeadDirection(target) {
    if (!target?.meshes?.length) return null;
    const inferred = inferRaisedEndDirection(target.meshes, target.box, {
      maxPerMesh: 2600,
      maxTotal: 22000,
      minConfidence: 0.045
    });
    return inferred?.direction?.clone?.().normalize() || null;
  }

  function evaluateBedRotation(group, targetBox, asset, rotationY, wallBoxes, options = {}, targetHeadDirection = null) {
    const targetSize = targetBox.getSize(new THREE.Vector3());
    const localHead = asset.headLocalDirection?.clone?.();
    const headDirection = rotateHorizontalDirection(localHead, rotationY);
    if (!headDirection) return null;

    group.position.set(0, 0, 0);
    group.scale.setScalar(1);
    group.rotation.y = rotationY;
    group.updateMatrixWorld(true);

    const sourceBox = new THREE.Box3().setFromObject(group);
    const sourceSize = sourceBox.getSize(new THREE.Vector3());
    const fitFootprint = Math.min(
      targetSize.x / Math.max(sourceSize.x, 0.001),
      targetSize.z / Math.max(sourceSize.z, 0.001)
    );
    const strictWall = nearestWallAtBedEnd(targetBox, headDirection, wallBoxes, true);
    const looseWall = Number.isFinite(strictWall.distance)
      ? strictWall
      : nearestWallAtBedEnd(targetBox, headDirection, wallBoxes, false);
    const wallLimit = bedWallDistanceLimit(targetSize, options);
    const wallDistance = looseWall.distance;
    const wallClear = Number.isFinite(wallDistance) && wallDistance <= wallLimit;
    return {
      rotationY,
      fitFootprint,
      headDirection,
      wallDistance,
      wallClear,
      wallExpressID: looseWall.wall?.expressID ?? null,
      originalDot: targetHeadDirection ? headDirection.dot(targetHeadDirection) : null
    };
  }

  function chooseBedReplacementRotation(group, targetBox, asset, wallBoxes, target, options = {}, fallbackRotation = 0) {
    if (asset.category !== "bed" || !asset.headLocalDirection) return null;
    const targetHeadDirection = inferTargetBedHeadDirection(target);
    const rotations = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
    const candidates = rotations
      .map((rotationY) => evaluateBedRotation(group, targetBox, asset, rotationY, wallBoxes, options, targetHeadDirection))
      .filter(Boolean);
    if (!candidates.length) return null;

    const bestFit = Math.max(...candidates.map((item) => item.fitFootprint));
    const fitTolerance = options.bedRotationFitTolerance ?? 0.56;
    const viable = candidates.filter((item) => item.fitFootprint >= bestFit * fitTolerance);
    const withWall = viable.filter((item) => item.wallClear);
    let chosen = null;
    let source = "fallback";

    if (withWall.length) {
      withWall.sort((a, b) => {
        const aPenalty = Math.max(0, bestFit * 0.92 - a.fitFootprint) * 0.25;
        const bPenalty = Math.max(0, bestFit * 0.92 - b.fitFootprint) * 0.25;
        return (a.wallDistance + aPenalty) - (b.wallDistance + bPenalty);
      });
      chosen = withWall[0];
      source = "wall";
    } else if (targetHeadDirection) {
      viable.sort((a, b) => {
        const dotDiff = (b.originalDot ?? -2) - (a.originalDot ?? -2);
        if (Math.abs(dotDiff) > 0.08) return dotDiff;
        return b.fitFootprint - a.fitFootprint;
      });
      chosen = viable[0];
      source = "original-bed-geometry";
    } else {
      chosen = candidates.find((item) => Math.abs(item.rotationY - fallbackRotation) < 0.001)
        || candidates.sort((a, b) => b.fitFootprint - a.fitFootprint)[0];
    }

    return {
      rotationY: chosen.rotationY,
      headDirection: chosen.headDirection,
      alignment: {
        source,
        shouldFlip: Math.abs(chosen.rotationY - fallbackRotation) > 0.001,
        clear: chosen.wallClear || source !== "wall",
        keepDistance: +chosen.wallDistance.toFixed(3),
        flipDistance: null,
        wallExpressID: chosen.wallExpressID,
        originalDot: chosen.originalDot == null ? null : +chosen.originalDot.toFixed(3),
        fitFootprint: +chosen.fitFootprint.toFixed(3)
      }
    };
  }

  function snapBedHeadToWall(group, headDirection, wallBoxes, options = {}) {
    if (!headDirection || !wallBoxes?.length) return null;
    const box = new THREE.Box3().setFromObject(group);
    if (!finiteBox(box)) return null;
    const nearest = nearestWallAtBedEnd(box, headDirection, wallBoxes, false);
    const distance = nearest.distance;
    if (!Number.isFinite(distance)) return null;
    const desiredGap = options.bedHeadGap ?? 0.055;
    const maxSnapDistance = options.bedHeadSnapDistance ?? 1.35;
    const maxMove = options.bedHeadSnapMax ?? 0.72;
    if (distance <= desiredGap || distance > maxSnapDistance) {
      return {
        moved: 0,
        distance: +distance.toFixed(3),
        desiredGap,
        wallExpressID: nearest.wall?.expressID ?? null
      };
    }
    const move = Math.min(maxMove, distance - desiredGap);
    group.position.addScaledVector(headDirection, move);
    group.updateMatrixWorld(true);
    return {
      moved: +move.toFixed(3),
      distance: +distance.toFixed(3),
      desiredGap,
      wallExpressID: nearest.wall?.expressID ?? null
    };
  }

  function colorToRgb(hex) {
    const color = new THREE.Color(hex);
    return [
      Math.round(color.r * 255),
      Math.round(color.g * 255),
      Math.round(color.b * 255)
    ];
  }

  function lerpByte(a, b, t) {
    return Math.round(a + (b - a) * t);
  }

  function stableNoise(x, y, seed = 1) {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
    return n - Math.floor(n);
  }

  function configureReplacementTexture(tex, repeat = [1, 1], srgb = false) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 4);
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  function makeCanvasTextureCacheKey(kind, opts) {
    return `${kind}:${JSON.stringify(opts)}`;
  }

  function makeWeaveTexture(opts = {}) {
    const size = opts.size || 512;
    const repeat = opts.repeat || [2, 2];
    const key = makeCanvasTextureCacheKey("weave", { ...opts, size, repeat });
    if (replacementTextureCache.has(key)) return replacementTextureCache.get(key);

    const base = colorToRgb(opts.base || 0xb9aa9b);
    const highlight = colorToRgb(opts.highlight || 0xd8cec2);
    const shadow = colorToRgb(opts.shadow || 0x8f8276);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(size, size);
    const thread = opts.thread || 34;
    const slub = opts.slub || 0.28;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const warp = Math.sin(u * Math.PI * 2 * thread);
        const weft = Math.sin(v * Math.PI * 2 * (thread * 0.72));
        const cross = Math.sin((u + v) * Math.PI * 2 * (thread * 0.16));
        const grain = stableNoise(Math.floor(x / 3), Math.floor(y / 3), opts.seed || 4) - 0.5;
        let weave = 0.5 + warp * 0.075 + weft * 0.055 + cross * 0.025 + grain * slub;
        if (opts.quilt) {
          const qx = Math.max(1, opts.quilt[0] || 3);
          const qy = Math.max(1, opts.quilt[1] || 4);
          const fx = (u * qx) % 1;
          const fy = (v * qy) % 1;
          const seamX = Math.max(0, 1 - Math.min(fx, 1 - fx) / (opts.quiltWidth ?? 0.026));
          const seamY = Math.max(0, 1 - Math.min(fy, 1 - fy) / (opts.quiltWidth ?? 0.026));
          const centerPuff = Math.max(0, 1 - Math.max(Math.abs(fx - 0.5), Math.abs(fy - 0.5)) * 2);
          weave += centerPuff * (opts.quiltPuff ?? 0.02);
          weave -= Math.max(seamX, seamY) * (opts.quiltDepth ?? 0.065);
        }
        const hi = Math.max(0, weave - 0.52) * 1.5;
        const lo = Math.max(0, 0.48 - weave) * 1.65;
        const shade = 1 - lo;
        const idx = (y * size + x) * 4;
        img.data[idx] = lerpByte(lerpByte(shadow[0], base[0], shade), highlight[0], hi);
        img.data[idx + 1] = lerpByte(lerpByte(shadow[1], base[1], shade), highlight[1], hi);
        img.data[idx + 2] = lerpByte(lerpByte(shadow[2], base[2], shade), highlight[2], hi);
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = configureReplacementTexture(new THREE.CanvasTexture(canvas), repeat, true);
    replacementTextureCache.set(key, tex);
    return tex;
  }

  function makePlushTexture(opts = {}) {
    const size = opts.size || 512;
    const repeat = opts.repeat || [2.4, 2.4];
    const key = makeCanvasTextureCacheKey("plush", { ...opts, size, repeat });
    if (replacementTextureCache.has(key)) return replacementTextureCache.get(key);

    const base = colorToRgb(opts.base || 0xb7a99d);
    const highlight = colorToRgb(opts.highlight || 0xe4d9cf);
    const shadow = colorToRgb(opts.shadow || 0x786b62);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(size, size);
    const fiber = opts.fiber || 42;
    const pile = opts.pile ?? 0.34;
    const angle = opts.angle ?? -0.45;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const along = u * ca + v * sa;
        const across = -u * sa + v * ca;
        const clump = stableNoise(Math.floor(x / 10), Math.floor(y / 10), opts.seed || 17);
        const fine = stableNoise(x, y, (opts.seed || 17) + 11);
        const strand = Math.sin((along + clump * 0.018) * Math.PI * 2 * fiber);
        const nap = Math.sin((along * 2.2 + across * 0.55 + clump * 0.28) * Math.PI * 2);
        const shortPile = Math.sin((along * 3.8 - across * 0.35 + fine * 0.12) * Math.PI * 2 * fiber * 0.24);
        const velvet = 0.5 + strand * 0.055 + shortPile * 0.035 + (clump - 0.5) * pile + (fine - 0.5) * 0.06;
        const napHighlight = Math.max(0, nap) * 0.07;
        const hi = Math.max(0, velvet - 0.48) * 1.35 + napHighlight;
        const lo = Math.max(0, 0.5 - velvet) * 1.55;
        const shade = 1 - lo;
        const idx = (y * size + x) * 4;
        img.data[idx] = lerpByte(lerpByte(shadow[0], base[0], shade), highlight[0], hi);
        img.data[idx + 1] = lerpByte(lerpByte(shadow[1], base[1], shade), highlight[1], hi);
        img.data[idx + 2] = lerpByte(lerpByte(shadow[2], base[2], shade), highlight[2], hi);
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = configureReplacementTexture(new THREE.CanvasTexture(canvas), repeat, true);
    replacementTextureCache.set(key, tex);
    return tex;
  }

  function makeFabricNormalTexture(opts = {}) {
    const size = opts.size || 256;
    const repeat = opts.repeat || [2, 2];
    const key = makeCanvasTextureCacheKey("fabricNormal", { ...opts, size, repeat });
    if (replacementTextureCache.has(key)) return replacementTextureCache.get(key);

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(size, size);
    const strength = opts.strength || 16;
    const thread = opts.thread || 36;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const dx = Math.cos(u * Math.PI * 2 * thread) * strength;
        const dy = Math.cos(v * Math.PI * 2 * thread * 0.78) * strength * 0.72;
        const noise = (stableNoise(x, y, opts.seed || 9) - 0.5) * strength * 0.35;
        const idx = (y * size + x) * 4;
        img.data[idx] = Math.max(0, Math.min(255, 128 + dx + noise));
        img.data[idx + 1] = Math.max(0, Math.min(255, 128 + dy - noise));
        img.data[idx + 2] = 255;
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = configureReplacementTexture(new THREE.CanvasTexture(canvas), repeat, false);
    replacementTextureCache.set(key, tex);
    return tex;
  }

  function makePlushNormalTexture(opts = {}) {
    const size = opts.size || 256;
    const repeat = opts.repeat || [2.4, 2.4];
    const key = makeCanvasTextureCacheKey("plushNormal", { ...opts, size, repeat });
    if (replacementTextureCache.has(key)) return replacementTextureCache.get(key);

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(size, size);
    const fiber = opts.fiber || 46;
    const strength = opts.strength || 18;
    const angle = opts.angle ?? -0.45;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const along = u * ca + v * sa;
        const across = -u * sa + v * ca;
        const clump = stableNoise(Math.floor(x / 8), Math.floor(y / 8), opts.seed || 23) - 0.5;
        const ridge = Math.cos((along + clump * 0.02) * Math.PI * 2 * fiber) * strength;
        const cross = Math.cos((across + clump * 0.03) * Math.PI * 2 * fiber * 0.22) * strength * 0.24;
        const noise = (stableNoise(x, y, (opts.seed || 23) + 5) - 0.5) * strength * 0.36;
        const nx = ridge * ca - cross * sa + noise;
        const ny = ridge * sa + cross * ca - noise * 0.45;
        const idx = (y * size + x) * 4;
        img.data[idx] = Math.max(0, Math.min(255, 128 + nx));
        img.data[idx + 1] = Math.max(0, Math.min(255, 128 + ny));
        img.data[idx + 2] = 255;
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = configureReplacementTexture(new THREE.CanvasTexture(canvas), repeat, false);
    replacementTextureCache.set(key, tex);
    return tex;
  }

  function makeSoftRoughnessTexture(opts = {}) {
    const size = opts.size || 256;
    const repeat = opts.repeat || [2, 2];
    const key = makeCanvasTextureCacheKey("roughness", { ...opts, size, repeat });
    if (replacementTextureCache.has(key)) return replacementTextureCache.get(key);

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(size, size);
    const base = opts.base ?? 0.86;
    const variance = opts.variance ?? 0.12;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const bands = Math.sin((x + y * 0.25) * 0.13) * 0.25;
        const noise = stableNoise(Math.floor(x / 4), Math.floor(y / 4), opts.seed || 13) - 0.5;
        const v = Math.max(0, Math.min(1, base + (bands + noise) * variance));
        const b = Math.round(v * 255);
        const idx = (y * size + x) * 4;
        img.data[idx] = img.data[idx + 1] = img.data[idx + 2] = b;
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = configureReplacementTexture(new THREE.CanvasTexture(canvas), repeat, false);
    replacementTextureCache.set(key, tex);
    return tex;
  }

  function makeWoodTexture(opts = {}) {
    const size = opts.size || 512;
    const repeat = opts.repeat || [1.2, 1.2];
    const key = makeCanvasTextureCacheKey("wood", { ...opts, size, repeat });
    if (replacementTextureCache.has(key)) return replacementTextureCache.get(key);

    const base = colorToRgb(opts.base || 0xc49a6c);
    const line = colorToRgb(opts.line || 0x8e6541);
    const glow = colorToRgb(opts.glow || 0xe3c390);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const bend = Math.sin(v * 16 + stableNoise(y, 4, 7) * 2.2) * 0.035;
        const ring = Math.sin((u + bend) * Math.PI * 2 * 18);
        const fine = Math.sin((u + bend) * Math.PI * 2 * 74) * 0.18;
        const pore = stableNoise(Math.floor(x / 2), y, 22) * 0.18;
        const t = Math.max(0, Math.min(1, 0.52 + ring * 0.18 + fine + pore));
        const idx = (y * size + x) * 4;
        img.data[idx] = lerpByte(lerpByte(line[0], base[0], t), glow[0], Math.max(0, t - 0.75) * 0.45);
        img.data[idx + 1] = lerpByte(lerpByte(line[1], base[1], t), glow[1], Math.max(0, t - 0.75) * 0.45);
        img.data[idx + 2] = lerpByte(lerpByte(line[2], base[2], t), glow[2], Math.max(0, t - 0.75) * 0.45);
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = configureReplacementTexture(new THREE.CanvasTexture(canvas), repeat, true);
    replacementTextureCache.set(key, tex);
    return tex;
  }

  function makeWoodRoughnessTexture(opts = {}) {
    return makeSoftRoughnessTexture({
      ...opts,
      base: opts.base ?? 0.54,
      variance: opts.variance ?? 0.18,
      repeat: opts.repeat || [1.2, 1.2],
      seed: opts.seed || 31
    });
  }

  function addFabricShader(mat, opts = {}) {
    const scale = opts.scale ?? 22;
    const strength = opts.strength ?? 0.055;
    const warmth = opts.warmth ?? 0.22;
    mat.userData.shader = "cozy-fabric-weave";
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.cozyWeaveScale = { value: scale };
      shader.uniforms.cozyWeaveStrength = { value: strength };
      shader.uniforms.cozyWeaveWarmth = { value: warmth };
      shader.fragmentShader = `
uniform float cozyWeaveScale;
uniform float cozyWeaveStrength;
uniform float cozyWeaveWarmth;
${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
#ifdef USE_MAP
  vec2 cozyUv = vMapUv * cozyWeaveScale;
  float cozyWarp = sin(cozyUv.x * 6.2831853);
  float cozyWeft = sin(cozyUv.y * 6.2831853);
  float cozyCross = sin((cozyUv.x + cozyUv.y) * 1.5707963);
  float cozyWeave = cozyWarp * 0.42 + cozyWeft * 0.34 + cozyCross * 0.12;
  diffuseColor.rgb *= 1.0 + cozyWeave * cozyWeaveStrength;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.035, 1.018, 0.982), cozyWeaveWarmth);
#endif`
      );
    };
    mat.customProgramCacheKey = () => `cozy-fabric-${scale}-${strength}-${warmth}`;
  }

  function addPlushShader(mat, opts = {}) {
    const scale = opts.scale ?? 18;
    const strength = opts.strength ?? 0.075;
    const softness = opts.softness ?? 0.24;
    mat.userData.shader = "plush-fabric-pile";
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.plushPileScale = { value: scale };
      shader.uniforms.plushPileStrength = { value: strength };
      shader.uniforms.plushPileSoftness = { value: softness };
      shader.fragmentShader = `
uniform float plushPileScale;
uniform float plushPileStrength;
uniform float plushPileSoftness;
${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
#ifdef USE_MAP
  vec2 plushUv = vMapUv * plushPileScale;
  float plushFiber = sin(plushUv.x * 6.2831853 + sin(plushUv.y * 2.1) * 1.35);
  float plushCross = sin((plushUv.x * 0.42 + plushUv.y * 0.88) * 6.2831853);
  float plushNoise = fract(sin(dot(floor(plushUv * 7.0), vec2(12.9898, 78.233))) * 43758.5453);
  float plushNap = plushFiber * 0.52 + plushCross * 0.18 + (plushNoise - 0.5) * 0.42;
  float plushPile = smoothstep(-0.36, 0.78, plushNap);
  diffuseColor.rgb *= 0.965 + plushPile * plushPileStrength;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.045, 1.03, 1.012), plushPileSoftness);
#endif`
      );
    };
    mat.customProgramCacheKey = () => `plush-fabric-${scale}-${strength}-${softness}`;
  }

  function replacementPalette(styleName = "luxury") {
    const palettes = {
      japandi: {
        sofa: [0xb7aa9b, 0xd8cec1, 0x8d8174],
        bed: [0xf3eee6, 0xfffbf5, 0xd6cbbd],
        chair: [0xaeb8a7, 0xd1d8ca, 0x7c8976],
        wood: [0xcaa978, 0x8e6846, 0xe6c995],
        metal: 0x34322d
      },
      luxury: {
        sofa: [0xb9aa99, 0xd8cab9, 0x88796a],
        bed: [0xe1ceb4, 0xf2e3ce, 0xbfa688],
        chair: [0x9fb3b0, 0xc7d7d3, 0x6e8582],
        wood: [0xc49a6c, 0x7a5031, 0xe4bf82],
        metal: 0xb79b58
      },
      volcanic: {
        sofa: [0x6a6158, 0x8a7f74, 0x3f3933],
        bed: [0xcfc5b8, 0xe6ddd1, 0x9b9185],
        chair: [0x6d7771, 0x929d96, 0x444d49],
        wood: [0x6b5844, 0x2d2118, 0x8c7458],
        metal: 0x171816
      },
      smart: {
        sofa: [0xbcb9b2, 0xd5d1ca, 0x96928b],
        bed: [0xded6ca, 0xeee8df, 0xbeb6aa],
        chair: [0xb8c4ca, 0xdbe4e8, 0x88969d],
        wood: [0xd6c3a2, 0xa8845a, 0xf0dcc0],
        metal: 0x98a4ad
      }
    };
    return palettes[styleName] || palettes.luxury;
  }

  function createReplacementMaterialSet(styleName = matFactory.activeStyle || "luxury") {
    const p = replacementPalette(styleName);
    const sofaMap = makePlushTexture({ base: p.sofa[0], highlight: p.sofa[1], shadow: p.sofa[2], repeat: [2.7, 2.7], fiber: 44, pile: 0.3, angle: -0.48, seed: 2 });
    const bedMap = makeWeaveTexture({ base: p.bed[0], highlight: p.bed[1], shadow: p.bed[2], repeat: [3.2, 3.2], thread: 40, slub: 0.12, quilt: [3, 5], quiltWidth: 0.024, quiltDepth: 0.055, quiltPuff: 0.018, seed: 5 });
    const chairMap = makeWeaveTexture({ base: p.chair[0], highlight: p.chair[1], shadow: p.chair[2], repeat: [2.7, 2.7], thread: 36, seed: 8 });
    const woodMap = makeWoodTexture({ base: p.wood[0], line: p.wood[1], glow: p.wood[2], repeat: [1.15, 1.15] });
    const fabricNormal = makeFabricNormalTexture({ repeat: [2.2, 2.2], strength: 13, thread: 38 });
    const sofaNormal = makePlushNormalTexture({ repeat: [2.7, 2.7], strength: 17, fiber: 48, angle: -0.48, seed: 12 });
    const bedNormal = makeFabricNormalTexture({ repeat: [3.2, 3.2], strength: 10, thread: 42, seed: 15 });
    const sofaRough = makeSoftRoughnessTexture({ repeat: [2.7, 2.7], base: 0.965, variance: 0.055, seed: 19 });
    const bedRough = makeSoftRoughnessTexture({ repeat: [3.2, 3.2], base: 0.94, variance: 0.07, seed: 21 });
    const woodRough = makeWoodRoughnessTexture({ repeat: [1.15, 1.15], base: 0.52, variance: 0.14 });

    const sofa = new THREE.MeshPhysicalMaterial({
      name: `replacement:${styleName}:plush-upholstery`,
      map: sofaMap,
      normalMap: sofaNormal,
      roughnessMap: sofaRough,
      color: 0xcbbcab,
      roughness: 0.965,
      metalness: 0,
      sheen: 0.9,
      sheenColor: new THREE.Color(p.sofa[1]),
      sheenRoughness: 0.74,
      specularIntensity: 0.08,
      envMapIntensity: 0.075
    });
    sofa.normalScale.set(0.24, 0.24);
    addPlushShader(sofa, { scale: 17.5, strength: 0.085, softness: 0.28 });

    const bed = new THREE.MeshPhysicalMaterial({
      name: `replacement:${styleName}:calm-bedding`,
      map: bedMap,
      normalMap: bedNormal,
      roughnessMap: bedRough,
      color: 0xe2d1bb,
      roughness: 0.965,
      metalness: 0,
      sheen: 0.28,
      sheenColor: new THREE.Color(p.bed[1]),
      sheenRoughness: 0.96,
      specularIntensity: 0.11,
      envMapIntensity: 0.065
    });
    bed.normalScale.set(0.12, 0.12);
    addFabricShader(bed, { scale: 26, strength: 0.042, warmth: 0.3 });

    const chair = sofa.clone();
    chair.name = `replacement:${styleName}:soft-chair`;
    chair.map = chairMap;
    chair.normalMap = fabricNormal;
    chair.roughnessMap = sofaRough;
    chair.sheenColor = new THREE.Color(p.chair[1]);
    chair.normalScale.set(0.16, 0.16);
    addFabricShader(chair, { scale: 24, strength: 0.04, warmth: 0.14 });

    const table = new THREE.MeshPhysicalMaterial({
      name: `replacement:${styleName}:warm-wood-table`,
      map: woodMap,
      roughnessMap: woodRough,
      color: 0x8a5e3b,
      roughness: 0.58,
      metalness: 0.02,
      clearcoat: 0.18,
      clearcoatRoughness: 0.48,
      anisotropy: 0.38,
      envMapIntensity: 0.5
    });

    [sofa, bed, chair, table].forEach((mat) => {
      mat.envMap = scene.environment;
      mat.needsUpdate = true;
    });
    return { sofa, bed, chair, table };
  }

  function disposeReplacementMaterials(set = replacementMaterialSet) {
    if (!set) return;
    Object.values(set).forEach((mat) => {
      try { mat.dispose(); } catch {}
    });
  }

  function getReplacementMaterialSet() {
    const styleName = matFactory.activeStyle || "luxury";
    if (replacementMaterialSet && replacementMaterialStyle === styleName) return replacementMaterialSet;
    disposeReplacementMaterials(replacementMaterialSet);
    replacementMaterialSet = createReplacementMaterialSet(styleName);
    replacementMaterialStyle = styleName;
    return replacementMaterialSet;
  }

  function updateReplacementMaterialEnvironment() {
    if (!replacementMaterialSet) return;
    Object.values(replacementMaterialSet).forEach((mat) => {
      mat.envMap = scene.environment;
      mat.needsUpdate = true;
    });
  }

  function synthesizeBoxUvForGeometry(geometry, repeatBias = 1) {
    if (!geometry || geometry.userData._replacementBoxUv) return;
    const position = geometry.getAttribute("position");
    if (!position) return;
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    const normal = geometry.getAttribute("normal");
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const sizeX = Math.max(box.max.x - box.min.x, 1e-4);
    const sizeY = Math.max(box.max.y - box.min.y, 1e-4);
    const sizeZ = Math.max(box.max.z - box.min.z, 1e-4);
    const uv = new Float32Array(position.count * 2);
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i);
      if (normal) n.fromBufferAttribute(normal, i);
      else n.set(0, 1, 0);
      const ax = Math.abs(n.x);
      const ay = Math.abs(n.y);
      const az = Math.abs(n.z);
      let u;
      let v;
      if (ax >= ay && ax >= az) {
        u = (p.z - box.min.z) / sizeZ;
        v = (p.y - box.min.y) / sizeY;
      } else if (ay >= ax && ay >= az) {
        u = (p.x - box.min.x) / sizeX;
        v = (p.z - box.min.z) / sizeZ;
      } else {
        u = (p.x - box.min.x) / sizeX;
        v = (p.y - box.min.y) / sizeY;
      }
      uv[i * 2] = u * repeatBias;
      uv[i * 2 + 1] = v * repeatBias;
    }
    const attr = new THREE.BufferAttribute(uv, 2);
    geometry.setAttribute("uv", attr);
    geometry.setAttribute("uv1", attr);
    geometry.setAttribute("uv2", attr);
    geometry.userData._replacementBoxUv = true;
  }

  function applyReplacementMaterialsToGroup(group, category = group?.userData?.replacementCategory) {
    if (!group || !category) return;
    const materialSet = getReplacementMaterialSet();
    const mat = materialSet[category] || materialSet.sofa;
    const repeatBias = category === "bed" ? 1.45 : category === "table" ? 0.85 : 1.15;
    group.traverse((child) => {
      if (!child.isMesh) return;
      synthesizeBoxUvForGeometry(child.geometry, repeatBias);
      child.material = mat;
      child.userData.replacementMaterial = mat.name;
      child.userData.replacementCategory = category;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    group.userData.replacementMaterialStyle = replacementMaterialStyle;
  }

  function debugFurnitureReplacementMaterialLooks() {
    const set = getReplacementMaterialSet();
    const surfaces = {};
    Object.entries(set).forEach(([category, mat]) => {
      surfaces[category] = {
        name: mat.name,
        color: mat.color?.getHexString?.() || null,
        roughness: Number.isFinite(mat.roughness) ? +mat.roughness.toFixed(3) : null,
        metalness: Number.isFinite(mat.metalness) ? +mat.metalness.toFixed(3) : null,
        sheen: Number.isFinite(mat.sheen) ? +mat.sheen.toFixed(3) : null,
        clearcoat: Number.isFinite(mat.clearcoat) ? +mat.clearcoat.toFixed(3) : null,
        envMapIntensity: Number.isFinite(mat.envMapIntensity) ? +mat.envMapIntensity.toFixed(3) : null,
        hasMap: !!mat.map,
        hasNormalMap: !!mat.normalMap,
        hasRoughnessMap: !!mat.roughnessMap,
        mapRepeat: mat.map?.repeat ? [+mat.map.repeat.x.toFixed(3), +mat.map.repeat.y.toFixed(3)] : null,
        normalScale: mat.normalScale?.isVector2 ? [+mat.normalScale.x.toFixed(3), +mat.normalScale.y.toFixed(3)] : null,
        shader: mat.userData.shader || null
      };
    });
    return {
      style: replacementMaterialStyle,
      textureCount: replacementTextureCache.size,
      activeGroups: replacementGroups.size,
      surfaces
    };
  }

  function collectFurnitureReplacementTargets() {
    const byKey = new Map();
    root.traverse((obj) => {
      const category = classifySceneFurnitureForReplacement(obj);
      if (!category || obj.userData._semanticReplacementHidden) return;
      const box = new THREE.Box3().setFromObject(obj);
      if (!finiteBox(box)) return;
      const size = box.getSize(new THREE.Vector3());
      if (size.y < 0.08 || Math.max(size.x, size.z) < 0.18) return;
      const key = obj.userData.expressID != null ? String(obj.userData.expressID) : obj.uuid;
      let item = byKey.get(key);
      if (!item) {
        item = {
          key,
          category,
          meshes: [],
          box: new THREE.Box3(),
          name: obj.userData.furnitureName || null,
          objectType: obj.userData.furnitureObjectType || null,
          tag: obj.userData.furnitureTag || null,
          expressID: obj.userData.expressID ?? null,
          expressIDs: obj.userData.expressID != null ? [obj.userData.expressID] : []
        };
        byKey.set(key, item);
      }
      item.meshes.push(obj);
      item.box.union(box);
    });
    const minFootprint = { sofa: 0.45, bed: 0.7, chair: 0.2, table: 0.25 };
    const candidates = Array.from(byKey.values()).filter((item) => {
      const size = item.box.getSize(new THREE.Vector3());
      const footprint = Math.max(size.x, size.z);
      return footprint >= (minFootprint[item.category] || 0.2);
    });
    return mergeFurnitureReplacementTargets(candidates);
  }

  function horizontalDistance(a, b) {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  function shouldMergeFurnitureTargets(a, b) {
    if (a.category !== b.category) return false;
    const aSize = a.box.getSize(new THREE.Vector3());
    const bSize = b.box.getSize(new THREE.Vector3());
    const aCenter = a.box.getCenter(new THREE.Vector3());
    const bCenter = b.box.getCenter(new THREE.Vector3());
    const maxFoot = Math.max(aSize.x, aSize.z, bSize.x, bSize.z);
    const pad = a.category === "chair"
      ? 0.08
      : Math.max(0.18, Math.min(0.65, maxFoot * 0.18));
    const yPad = a.category === "chair" ? 0.08 : 0.22;
    const inflated = a.box.clone().expandByVector(new THREE.Vector3(pad, yPad, pad));
    if (inflated.intersectsBox(b.box)) return true;

    const verticalOverlap = a.box.max.y >= b.box.min.y - yPad && b.box.max.y >= a.box.min.y - yPad;
    if (!verticalOverlap) return false;
    const closeEnough = horizontalDistance(aCenter, bCenter) < Math.max(0.18, maxFoot * (a.category === "chair" ? 0.12 : 0.42));
    return closeEnough;
  }

  function mergeFurnitureReplacementTargets(items) {
    const clusters = [];
    items
      .slice()
      .sort((a, b) => {
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        const ac = a.box.getCenter(new THREE.Vector3());
        const bc = b.box.getCenter(new THREE.Vector3());
        return ac.x - bc.x || ac.z - bc.z;
      })
      .forEach((item) => {
        let target = clusters.find((cluster) => shouldMergeFurnitureTargets(cluster, item));
        if (!target) {
          target = {
            key: item.key,
            category: item.category,
            meshes: [],
            box: new THREE.Box3(),
            name: item.name,
            objectType: item.objectType,
            tag: item.tag,
            expressID: item.expressID,
            expressIDs: []
          };
          clusters.push(target);
        }
        target.meshes.push(...item.meshes);
        target.box.union(item.box);
        target.expressIDs.push(...(item.expressIDs || []));
        if (!target.name && item.name) target.name = item.name;
        if (!target.objectType && item.objectType) target.objectType = item.objectType;
        if (!target.tag && item.tag) target.tag = item.tag;
      });
    clusters.forEach((cluster, index) => {
      cluster.key = `${cluster.category}:${index}:${cluster.expressIDs.join(",") || cluster.key}`;
      cluster.expressIDs = Array.from(new Set(cluster.expressIDs));
    });
    return clusters;
  }

  function debugFurnitureReplacementCandidates() {
    const targets = collectFurnitureReplacementTargets();
    const result = {
      total: targets.length,
      byCategory: { sofa: 0, bed: 0, chair: 0, table: 0 },
      samples: []
    };
    targets.forEach((item) => {
      result.byCategory[item.category] = (result.byCategory[item.category] || 0) + 1;
      if (result.samples.length < 24) {
        result.samples.push({
          category: item.category,
          expressID: item.expressID,
          expressIDs: item.expressIDs,
          name: item.name,
          objectType: item.objectType,
          box: boxSnapshot(item.box)
        });
      }
    });
    return result;
  }

  function collectBedAccessoryMeshesToHide(targets) {
    const bedTargets = targets.filter((target) => target.category === "bed");
    if (!bedTargets.length) return [];
    const bedTargetMeshSet = new Set();
    bedTargets.forEach((target) => target.meshes.forEach((mesh) => bedTargetMeshSet.add(mesh)));
    const accessories = [];
    const seen = new Set();
    root.traverse((obj) => {
      if (!obj.isMesh || seen.has(obj)) return;
      const box = new THREE.Box3().setFromObject(obj);
      if (!finiteBox(box)) return;
      const match = shouldHideBedAccessory(obj, box, bedTargets, bedTargetMeshSet);
      if (!match) return;
      seen.add(obj);
      accessories.push({
        mesh: obj,
        box,
        match,
        name: obj.userData.furnitureName || null,
        objectType: obj.userData.furnitureObjectType || null,
        tag: obj.userData.furnitureTag || null,
        expressID: obj.userData.expressID ?? null,
        materialKey: obj.userData.furnitureMaterialKey || null
      });
    });
    return accessories;
  }

  function makeBakedAssetRoot(sourceNode) {
    sourceNode.updateMatrixWorld(true);
    const baked = new THREE.Group();
    const clone = sourceNode.clone(true);
    clone.matrix.copy(sourceNode.matrixWorld);
    clone.matrixAutoUpdate = false;
    baked.add(clone);
    baked.updateMatrixWorld(true);
    return baked;
  }

  function makeRoundedReplacementPart(name, size, position, radius) {
    const geometry = new RoundedBoxGeometry(size.x, size.y, size.z, 4, radius);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry);
    mesh.name = name;
    mesh.position.copy(position);
    mesh.userData.cleanReplacementBed = true;
    return mesh;
  }

  function makeCleanBedAssetRoot(sourceBox, headDirection) {
    const size = sourceBox.getSize(new THREE.Vector3());
    const root = new THREE.Group();
    root.name = "clean-bed-no-rack";

    const head = headDirection?.clone?.() || new THREE.Vector3(1, 0, 0);
    head.y = 0;
    if (head.lengthSq() < 0.001) head.set(1, 0, 0);
    head.normalize();
    const headAxis = Math.abs(head.x) >= Math.abs(head.z) ? "x" : "z";
    const headSign = head[headAxis] >= 0 ? 1 : -1;
    const crossAxis = headAxis === "x" ? "z" : "x";
    const length = Math.max(size[headAxis], 0.8);
    const width = Math.max(size[crossAxis], 0.62);
    const height = Math.max(size.y, 0.42);

    const place = (along, y, across = 0) => {
      const v = new THREE.Vector3(0, y, 0);
      v[headAxis] = along * headSign;
      v[crossAxis] = across;
      return v;
    };
    const dims = (along, y, across) => {
      const v = new THREE.Vector3();
      v[headAxis] = along;
      v.y = y;
      v[crossAxis] = across;
      return v;
    };

    const baseH = Math.max(height * 0.16, 0.1);
    const mattressH = Math.max(height * 0.26, 0.14);
    const duvetH = Math.max(height * 0.14, 0.075);
    const pillowH = Math.max(height * 0.17, 0.085);
    const topY = baseH + mattressH;

    root.add(makeRoundedReplacementPart(
      "clean-bed:soft-base",
      dims(length * 0.98, baseH, width * 0.96),
      place(0, baseH * 0.5),
      Math.min(width, length) * 0.025
    ));
    root.add(makeRoundedReplacementPart(
      "clean-bed:mattress",
      dims(length * 0.92, mattressH, width * 0.9),
      place(-length * 0.02, baseH + mattressH * 0.5),
      Math.min(width, length) * 0.045
    ));
    root.add(makeRoundedReplacementPart(
      "clean-bed:duvet",
      dims(length * 0.58, duvetH, width * 0.86),
      place(-length * 0.13, topY + duvetH * 0.58),
      Math.min(width, length) * 0.055
    ));

    const pillowCount = width > 1.75 ? 3 : 2;
    const pillowAlong = length * 0.13;
    const pillowAcross = width * (pillowCount === 3 ? 0.2 : 0.27);
    const pillowGap = width * (pillowCount === 3 ? 0.21 : 0.22);
    const pillowOffsets = pillowCount === 3 ? [-pillowGap, 0, pillowGap] : [-pillowGap * 0.48, pillowGap * 0.48];
    pillowOffsets.forEach((offset, index) => {
      const pillow = makeRoundedReplacementPart(
        `clean-bed:pillow-${index + 1}`,
        dims(pillowAlong, pillowH * 0.82, pillowAcross),
        place(length * 0.25, topY + pillowH * 0.48, offset),
        Math.min(pillowAlong, pillowAcross) * 0.2
      );
      pillow.rotation[crossAxis === "x" ? "z" : "x"] = (index % 2 ? -1 : 1) * 0.035;
      root.add(pillow);
    });

    root.updateMatrixWorld(true);
    return root;
  }

  function loadFurnitureReplacementLibrary(url) {
    const absUrl = new URL(url, location.href).href;
    if (replacementLibraryCache.has(absUrl)) return replacementLibraryCache.get(absUrl);
    const promise = new Promise((resolve, reject) => {
      gltfLoader.load(
        absUrl,
        (gltf) => {
          gltf.scene.updateMatrixWorld(true);
          const library = { url: absUrl, assets: { sofa: [], bed: [], chair: [], table: [] } };
          gltf.scene.traverse((node) => {
            if (!node.isMesh) return;
            const category = classifyJiajuAssetName(node.name);
            if (!category) return;
            const bakedRoot = makeBakedAssetRoot(node);
            const bakedBox = new THREE.Box3().setFromObject(bakedRoot);
            if (!finiteBox(bakedBox)) return;
            const headInfo = category === "bed"
              ? inferRaisedEndDirection(bakedRoot, bakedBox)
              : null;
            const rootClone = category === "bed"
              ? makeCleanBedAssetRoot(bakedBox, headInfo?.direction)
              : bakedRoot;
            const box = new THREE.Box3().setFromObject(rootClone);
            if (!finiteBox(box)) return;
            const size = box.getSize(new THREE.Vector3());
            library.assets[category].push({
              category,
              name: node.name || category,
              root: rootClone,
              size: size.clone(),
              box: box.clone(),
              cleanNoRack: category === "bed",
              headLocalDirection: headInfo?.direction?.clone?.() || null,
              headInference: headInfo
                ? {
                    axis: headInfo.axis,
                    sign: headInfo.sign,
                    confidence: headInfo.confidence,
                    cleanNoRack: true
                  }
                : null
            });
          });
          resolve(library);
        },
        undefined,
        (err) => reject(new Error(`replacement GLB failed for "${url}": ${err.message || err}`))
      );
    });
    replacementLibraryCache.set(absUrl, promise);
    return promise;
  }

  function prepareReplacementInstance(asset) {
    const wrapper = new THREE.Group();
    wrapper.name = asset.name;
    const content = asset.root.clone(true);
    wrapper.add(content);
    wrapper.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wrapper);
    const center = box.getCenter(new THREE.Vector3());
    content.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
    wrapper.updateMatrixWorld(true);
    applyReplacementMaterialsToGroup(wrapper, asset.category);
    wrapper.traverse((child) => {
      if (!child.isMesh) return;
      if (!child.geometry?.boundingBox) child.geometry?.computeBoundingBox?.();
      if (!child.geometry?.boundingSphere) child.geometry?.computeBoundingSphere?.();
      child.castShadow = true;
      child.receiveShadow = true;
      if (scene.environment && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((mat) => {
          mat.envMap = scene.environment;
          mat.envMapIntensity = mat.envMapIntensity ?? 1.0;
          mat.needsUpdate = true;
        });
      }
    });
    return wrapper;
  }

  function scoreAssetFit(asset, targetSize) {
    const source = asset.size;
    const noRot = Math.min(targetSize.x / Math.max(source.x, 0.001), targetSize.z / Math.max(source.z, 0.001));
    const rot = Math.min(targetSize.x / Math.max(source.z, 0.001), targetSize.z / Math.max(source.x, 0.001));
    return Math.max(noRot, rot);
  }

  function chooseReplacementAsset(library, category, targetBox) {
    const candidates = library.assets[category] || [];
    if (!candidates.length) return null;
    const targetSize = targetBox.getSize(new THREE.Vector3());
    return candidates
      .map((asset) => ({ asset, score: scoreAssetFit(asset, targetSize) }))
      .sort((a, b) => b.score - a.score)[0].asset;
  }

  function fitReplacementToBox(group, targetBox, options = {}) {
    const targetCenter = targetBox.getCenter(new THREE.Vector3());
    const targetSize = targetBox.getSize(new THREE.Vector3());
    const padding = options.padding ?? 0.94;
    const isBed = options.asset?.category === "bed";

    const bestRotation = (() => {
      group.position.set(0, 0, 0);
      group.scale.setScalar(1);
      group.rotation.y = 0;
      group.updateMatrixWorld(true);
      const box0 = new THREE.Box3().setFromObject(group);
      const size0 = box0.getSize(new THREE.Vector3());
      const scale0 = Math.min(targetSize.x / Math.max(size0.x, 0.001), targetSize.z / Math.max(size0.z, 0.001));
      group.rotation.y = Math.PI / 2;
      group.updateMatrixWorld(true);
      const box90 = new THREE.Box3().setFromObject(group);
      const size90 = box90.getSize(new THREE.Vector3());
      const scale90 = Math.min(targetSize.x / Math.max(size90.x, 0.001), targetSize.z / Math.max(size90.z, 0.001));
      return scale90 > scale0 * 1.06 ? Math.PI / 2 : 0;
    })();
    let finalRotation = bestRotation;
    let bedHeadDirection = null;
    let bedHeadSnap = null;

    if (isBed) {
      const rotationChoice = chooseBedReplacementRotation(
        group,
        targetBox,
        options.asset,
        options.wallBoxes,
        options.target,
        options,
        bestRotation
      );
      if (rotationChoice) {
        finalRotation = rotationChoice.rotationY;
        bedHeadDirection = rotationChoice.headDirection?.clone?.() || null;
        group.userData.bedHeadAlignment = rotationChoice.alignment;
      } else {
        const localHead = options.asset.headLocalDirection?.clone?.();
        const rotateHead = (rotation) => rotateHorizontalDirection(localHead, rotation);
        const baseHeadDirection = rotateHead(bestRotation);
        const wallAlignment = baseHeadDirection
          ? chooseBedHeadWallAlignment(targetBox, baseHeadDirection, options.wallBoxes, options)
          : null;
        const originalAlignment = baseHeadDirection && (!wallAlignment || wallAlignment.clear === false)
          ? chooseBedHeadOriginalAlignment(options.target, baseHeadDirection)
          : null;
        const alignment = originalAlignment || wallAlignment;
        if (alignment?.shouldFlip) finalRotation += Math.PI;
        bedHeadDirection = rotateHead(finalRotation);
        group.userData.bedHeadAlignment = alignment || {
          source: "unresolved",
          shouldFlip: false
        };
      }
      group.userData.bedHeadDirection = directionSnapshot(bedHeadDirection);
      group.userData.bedHeadAssetInference = options.asset.headInference || null;
    }

    group.position.set(0, 0, 0);
    group.rotation.y = finalRotation;
    group.scale.setScalar(1);
    group.updateMatrixWorld(true);
    const sourceBox = new THREE.Box3().setFromObject(group);
    const sourceSize = sourceBox.getSize(new THREE.Vector3());
    const fitFootprint = Math.min(
      targetSize.x / Math.max(sourceSize.x, 0.001),
      targetSize.z / Math.max(sourceSize.z, 0.001)
    );
    const bedScaleBoost = isBed
      ? options.bedScaleBoost ?? (Math.max(targetSize.x, targetSize.z) < 2.4 ? 1.18 : 1.1)
      : 1;
    const fitHeightBoost = isBed ? 1.32 : 1.12;
    const fitHeight = targetSize.y > 0.12
      ? (targetSize.y / Math.max(sourceSize.y, 0.001)) * fitHeightBoost
      : fitFootprint;
    const scale = Math.max(0.0001, Math.min(fitFootprint, fitHeight) * padding * bedScaleBoost);
    group.scale.setScalar(scale);
    group.updateMatrixWorld(true);

    const scaledBox = new THREE.Box3().setFromObject(group);
    const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
    group.position.set(
      targetCenter.x - scaledCenter.x,
      targetBox.min.y - scaledBox.min.y,
      targetCenter.z - scaledCenter.z
    );
    group.updateMatrixWorld(true);
    if (isBed && bedHeadDirection) {
      bedHeadSnap = snapBedHeadToWall(group, bedHeadDirection, options.wallBoxes, options);
      group.userData.bedHeadSnap = bedHeadSnap;
    }
    return {
      rotationY: finalRotation,
      baseRotationY: bestRotation,
      flipped: Math.abs(finalRotation - bestRotation) > 0.001,
      bedHeadSnap
    };
  }

  async function replaceSemanticFurnitureFromGlb(url = "./jiaju1.glb", options = {}) {
    clearSemanticFurnitureReplacements();
    const library = await loadFurnitureReplacementLibrary(url);
    const targets = collectFurnitureReplacementTargets();
    const result = {
      source: url,
      assets: Object.fromEntries(Object.entries(library.assets).map(([key, list]) => [key, list.map((item) => item.name)])),
      totalTargets: targets.length,
      replaced: 0,
      skipped: 0,
      byCategory: { sofa: 0, bed: 0, chair: 0, table: 0 },
      cleanBedReplacements: 0,
      hiddenBedAccessories: 0,
      hiddenBedAccessorySamples: [],
      samples: []
    };
    const wallBoxes = collectFurnitureReplacementWallBoxes();
    result.wallCandidates = wallBoxes.length;
    const bedAccessoriesToHide = collectBedAccessoryMeshesToHide(targets);

    targets.forEach((target) => {
      const asset = chooseReplacementAsset(library, target.category, target.box);
      if (!asset) {
        result.skipped++;
        return;
      }
      const group = prepareReplacementInstance(asset);
      group.name = `replacement:${target.category}:${target.expressID ?? target.key}:${asset.name}`;
      group.userData.system = "architecture";
      group.visible = systemEnabled.get("architecture") ?? true;
      group.userData.replacementCategory = target.category;
      group.userData.replacementAsset = asset.name;
      group.userData.replacedExpressID = target.expressID;
      group.userData.replacedExpressIDs = target.expressIDs || [];
      const fitInfo = fitReplacementToBox(group, target.box, {
        ...options,
        asset,
        target,
        wallBoxes
      });
      root.add(group);
      replacementGroups.add(group);

      target.meshes.forEach((mesh) => {
        mesh.userData._semanticReplacementHidden = true;
        mesh.visible = false;
        replacedOriginals.add(mesh);
      });
      applyLevelToGroup(group);
      result.replaced++;
      result.byCategory[target.category] = (result.byCategory[target.category] || 0) + 1;
      if (target.category === "bed" && asset.cleanNoRack) result.cleanBedReplacements++;
      if (result.samples.length < 24) {
        result.samples.push({
          category: target.category,
          expressID: target.expressID,
          name: target.name,
          asset: asset.name,
          cleanNoRack: !!asset.cleanNoRack,
          box: boxSnapshot(target.box),
          rotationY: +fitInfo.rotationY.toFixed(3),
          bedHeadAlignment: group.userData.bedHeadAlignment || null,
          bedHeadDirection: group.userData.bedHeadDirection || null,
          bedHeadSnap: group.userData.bedHeadSnap || null
        });
      }
    });

    bedAccessoriesToHide.forEach((item) => {
      item.mesh.userData._semanticReplacementHidden = true;
      item.mesh.userData._semanticReplacementHiddenReason = "bed-accessory";
      item.mesh.visible = false;
      replacedOriginals.add(item.mesh);
      result.hiddenBedAccessories++;
      if (result.hiddenBedAccessorySamples.length < 16) {
        result.hiddenBedAccessorySamples.push({
          expressID: item.expressID,
          name: item.name,
          objectType: item.objectType,
          tag: item.tag,
          materialKey: item.materialKey,
          bedExpressID: item.match.bedExpressID,
          distance: item.match.distance,
          semanticShelf: item.match.semanticShelf,
          transparentFurniture: item.match.transparentFurniture,
          box: boxSnapshot(item.box)
        });
      }
    });

    markDirty();
    return result;
  }

  function clearSemanticFurnitureReplacements() {
    replacementGroups.forEach((group) => root.remove(group));
    replacementGroups.clear();
    replacedOriginals.forEach((mesh) => {
      delete mesh.userData._semanticReplacementHidden;
      delete mesh.userData._semanticReplacementHiddenReason;
      mesh.visible = true;
    });
    replacedOriginals.clear();
    root.children.forEach(applyLevelToGroup);
    markDirty();
  }

  function makeChuangshaFineMeshTexture() {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 96;
    textureCanvas.height = 96;
    const context = textureCanvas.getContext("2d");
    context.clearRect(0, 0, textureCanvas.width, textureCanvas.height);
    context.fillStyle = "rgba(42, 50, 48, 0.12)";
    context.fillRect(0, 0, textureCanvas.width, textureCanvas.height);
    context.strokeStyle = "rgba(12, 18, 17, 0.62)";
    context.lineWidth = 0.75;
    for (let point = 0.5; point < textureCanvas.width; point += 4) {
      context.beginPath();
      context.moveTo(point, 0);
      context.lineTo(point, textureCanvas.height);
      context.stroke();
      context.beginPath();
      context.moveTo(0, point);
      context.lineTo(textureCanvas.width, point);
      context.stroke();
    }
    context.strokeStyle = "rgba(230, 238, 234, 0.1)";
    context.lineWidth = 0.5;
    for (let point = 2.5; point < textureCanvas.width; point += 4) {
      context.beginPath();
      context.moveTo(point, 0);
      context.lineTo(point, textureCanvas.height);
      context.stroke();
      context.beginPath();
      context.moveTo(0, point);
      context.lineTo(textureCanvas.width, point);
      context.stroke();
    }

    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(32, 72);
    texture.anisotropy = renderer.capabilities?.getMaxAnisotropy?.() || 1;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  function makeChuangshaBrushedTitaniumTexture() {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 128;
    textureCanvas.height = 128;
    const context = textureCanvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, textureCanvas.width, 0);
    gradient.addColorStop(0, "#bfc4c1");
    gradient.addColorStop(0.5, "#e3e5df");
    gradient.addColorStop(1, "#aeb6b3");
    context.fillStyle = gradient;
    context.fillRect(0, 0, textureCanvas.width, textureCanvas.height);
    for (let y = 0; y < textureCanvas.height; y += 2) {
      const alpha = y % 8 === 0 ? 0.16 : 0.055;
      context.strokeStyle = `rgba(255,255,255,${alpha})`;
      context.beginPath();
      context.moveTo(0, y + 0.5);
      context.lineTo(textureCanvas.width, y + 0.5);
      context.stroke();
      context.strokeStyle = `rgba(44,50,48,${alpha * 0.55})`;
      context.beginPath();
      context.moveTo(0, y + 1.5);
      context.lineTo(textureCanvas.width, y + 1.5);
      context.stroke();
    }
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.2, 18);
    texture.anisotropy = renderer.capabilities?.getMaxAnisotropy?.() || 1;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  function getChuangshaMaterialSet() {
    if (chuangshaMaterialSet) return chuangshaMaterialSet;
    const meshTexture = makeChuangshaFineMeshTexture();
    const titaniumTexture = makeChuangshaBrushedTitaniumTexture();
    chuangshaMaterialSet = {
      frame: new THREE.MeshPhysicalMaterial({
        color: 0xd1d5d2,
        map: titaniumTexture,
        roughnessMap: titaniumTexture,
        roughness: 0.14,
        metalness: 1,
        envMapIntensity: 2.35,
        clearcoat: 0.36,
        clearcoatRoughness: 0.2,
        anisotropy: 0.72,
        anisotropyRotation: Math.PI * 0.5
      }),
      label: new THREE.MeshStandardMaterial({
        color: 0x050505,
        roughness: 0.64,
        metalness: 0.02
      }),
      display: new THREE.MeshPhysicalMaterial({
        color: 0x010203,
        roughness: 0.18,
        metalness: 0.08,
        envMapIntensity: 1.25,
        clearcoat: 0.92,
        clearcoatRoughness: 0.05,
        emissive: 0x020706,
        emissiveIntensity: 0.035
      }),
      button: new THREE.MeshPhysicalMaterial({
        color: 0xc7c5bb,
        roughness: 0.16,
        metalness: 0.82,
        envMapIntensity: 1.85,
        clearcoat: 0.55,
        clearcoatRoughness: 0.12
      }),
      screen: new THREE.MeshStandardMaterial({
        color: 0xb8bcb5,
        roughness: 0.82,
        metalness: 0,
        map: meshTexture,
        alphaMap: meshTexture,
        transparent: true,
        opacity: 0.36,
        side: THREE.DoubleSide,
        depthWrite: false
      }),
      lines: new THREE.LineBasicMaterial({
        color: 0x2c302d,
        transparent: true,
        opacity: 0.22,
        depthWrite: false
      }),
      texture: meshTexture,
      titaniumTexture
    };
    chuangshaMaterialSet.frame.name = "chuangsha_titanium_frame";
    chuangshaMaterialSet.label.name = "chuangsha_black_lower_label";
    chuangshaMaterialSet.display.name = "chuangsha_black_glass_display";
    chuangshaMaterialSet.button.name = "chuangsha_satin_control_button";
    chuangshaMaterialSet.screen.name = "chuangsha_fine_insect_screen";
    chuangshaMaterialSet.lines.name = "chuangsha_visible_screen_threads";
    return chuangshaMaterialSet;
  }

  function disposeChuangshaMaterialSet(set = chuangshaMaterialSet) {
    if (!set) return;
    try { set.texture?.dispose?.(); } catch {}
    try { set.titaniumTexture?.dispose?.(); } catch {}
    ["frame", "label", "display", "button", "screen", "lines"].forEach((key) => {
      try { set[key]?.dispose?.(); } catch {}
    });
    if (set === chuangshaMaterialSet) chuangshaMaterialSet = null;
  }

  function disposeChuangshaLocalMaterial(material) {
    const materials = Array.isArray(material) ? material : [material];
    materials.forEach((mat) => {
      if (!mat?.userData?.chuangshaLocalClone) return;
      try { mat.dispose?.(); } catch {}
    });
  }

  function makeChuangshaTitaniumMaterial(sourceMaterial, fallback, options = {}) {
    const cloneOne = (sourceMaterial) => {
      const source = options.forceTitanium ? fallback : (sourceMaterial?.clone ? sourceMaterial : fallback);
      const clone = source?.clone ? source.clone() : null;
      if (!clone) return null;
      clone.name = `${clone.name || "chuangsha_original"}_${options.forceTitanium ? "titanium" : "preserved"}`;
      if (options.forceTitanium && clone.color) clone.color.set(options.tintColor ?? 0xc6c8c2);
      if (options.forceTitanium && options.detailMap) {
        if ("map" in clone) clone.map = options.detailMap;
        if ("roughnessMap" in clone) clone.roughnessMap = options.detailMap;
      }
      if ("envMapIntensity" in clone && options.envMapIntensity != null) {
        clone.envMapIntensity = options.envMapIntensity;
      }
      if ("metalness" in clone && options.minMetalness != null) {
        clone.metalness = Math.max(clone.metalness ?? 0, options.minMetalness);
      }
      if (clone.color && options.tintColor != null && options.tintStrength != null) {
        clone.color.lerp(new THREE.Color(options.tintColor), Math.max(0, Math.min(1, options.tintStrength)));
      }
      if ("roughness" in clone && options.minRoughness != null) {
        clone.roughness = Math.max(clone.roughness ?? options.minRoughness, options.minRoughness);
      }
      if ("roughness" in clone && options.maxRoughness != null) {
        clone.roughness = Math.min(clone.roughness ?? options.maxRoughness, options.maxRoughness);
      }
      if ("clearcoat" in clone && options.clearcoat != null) clone.clearcoat = options.clearcoat;
      if ("clearcoatRoughness" in clone && options.clearcoatRoughness != null) clone.clearcoatRoughness = options.clearcoatRoughness;
      if ("anisotropy" in clone && options.anisotropy != null) clone.anisotropy = options.anisotropy;
      if ("anisotropyRotation" in clone && options.anisotropyRotation != null) clone.anisotropyRotation = options.anisotropyRotation;
      clone.userData = {
        ...(clone.userData || {}),
        chuangshaLocalClone: true,
        chuangshaPreservedOriginalColor: !options.forceTitanium,
        chuangshaTitaniumOverride: !!options.forceTitanium
      };
      clone.needsUpdate = true;
      return clone;
    };

    if (Array.isArray(sourceMaterial)) {
      const clones = sourceMaterial.map((mat) => cloneOne(mat)).filter(Boolean);
      return clones.length ? clones : fallback;
    }
    return cloneOne(sourceMaterial) || fallback;
  }

  function getChuangshaMeshSummaries(group) {
    const parts = [];
    group.updateMatrixWorld(true);
    group.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.geometry) return;
      if (mesh.userData?.chuangshaGeneratedOverlay) return;
      const box = new THREE.Box3().setFromObject(mesh);
      if (!finiteBox(box)) return;
      const size = box.getSize(new THREE.Vector3());
      parts.push({
        mesh,
        name: mesh.name || mesh.parent?.name || `chuangsha_part_${parts.length + 1}`,
        box,
        center: box.getCenter(new THREE.Vector3()),
        size,
        flatness: Math.min(size.x, size.z) / Math.max(size.x, size.y, size.z, 0.001)
      });
    });
    return parts;
  }

  function classifyChuangshaParts(parts) {
    let backing = null;
    let screen = null;
    parts.forEach((part) => {
      if (!backing || part.size.y > backing.size.y) backing = part;
    });
    parts.forEach((part) => {
      const isLargeFlat =
        part !== backing && part.flatness < 0.012 && part.size.y > 0.32 && part.size.x > 0.24;
      if (isLargeFlat && (!screen || part.size.y > screen.size.y)) screen = part;
    });
    const backingWidth = Math.max(backing?.size.x ?? 0.6, 0.001);
    const backingHeight = Math.max(backing?.size.y ?? 1.35, 0.001);
    const backingMinY = backing?.box?.min?.y ?? 0;
    const backingCenterX = backing?.center?.x ?? 0;

    parts.forEach((part) => {
      const isHorizontalBar =
        part !== backing &&
        part !== screen &&
        part.size.x > backingWidth * 0.72 &&
        part.size.y < backingHeight * 0.08;
      const isLowerFrameDisplay =
        part !== backing &&
        part !== screen &&
        !isHorizontalBar &&
        part.center.x < backingCenterX - backingWidth * 0.12 &&
        part.center.y < backingMinY + backingHeight * 0.08 &&
        part.size.x > backingWidth * 0.22 &&
        part.size.y < backingHeight * 0.04 &&
        part.size.z < backingWidth * 0.02;
      const isControlButton =
        part !== backing &&
        part !== screen &&
        !isHorizontalBar &&
        !isLowerFrameDisplay &&
        part.center.y < backingMinY + backingHeight * 0.1 &&
        Math.abs(part.center.x - backingCenterX) < backingWidth * 0.22 &&
        part.size.x < backingWidth * 0.16 &&
        part.size.y < backingHeight * 0.08 &&
        part.size.z < backingWidth * 0.06;

      if (part === backing) part.role = "static_backing";
      else if (part === screen) part.role = "screen";
      else if (isHorizontalBar) part.role = "pull_bar";
      else if (isLowerFrameDisplay) part.role = "display_panel";
      else if (isControlButton) part.role = "control_button";
      else part.role = "drive_detail";
    });
    return { backing, screen, parts };
  }

  const CHUANGSHA_SCREEN_AXES = ["x", "y", "z"];

  function readBufferAxis(position, axis, index) {
    if (axis === "x") return position.getX(index);
    if (axis === "y") return position.getY(index);
    return position.getZ(index);
  }

  function writeBufferAxis(position, axis, index, value) {
    if (axis === "x") position.setX(index, value);
    else if (axis === "y") position.setY(index, value);
    else position.setZ(index, value);
  }

  function getGeometryPlaneInfo(geometry) {
    if (!geometry?.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const size = box.getSize(new THREE.Vector3());
    const planeAxes = CHUANGSHA_SCREEN_AXES
      .slice()
      .sort((a, b) => size[b] - size[a])
      .slice(0, 2);
    const flatAxis = CHUANGSHA_SCREEN_AXES.find((axis) => !planeAxes.includes(axis)) || "y";
    return { box, size, planeAxes, flatAxis };
  }

  function insetChuangshaScreenGeometry(mesh) {
    const geometry = mesh.geometry;
    if (!geometry?.attributes?.position) return getGeometryPlaneInfo(geometry);
    if (!mesh.userData.chuangshaScreenInsetApplied) {
      const info = getGeometryPlaneInfo(geometry);
      const center = info.box.getCenter(new THREE.Vector3());
      const position = geometry.attributes.position;
      const insetByAxis = {};
      info.planeAxes.forEach((axis) => {
        const axisSize = Math.max(info.size[axis], 0);
        const inset = Math.min(axisSize * 0.12, Math.max(axisSize * 0.035, 0.018));
        insetByAxis[axis] = Math.min(inset, axisSize * 0.18);
      });
      for (let index = 0; index < position.count; index++) {
        info.planeAxes.forEach((axis) => {
          const axisSize = Math.max(info.size[axis], 0.0001);
          const scale = Math.max(0.52, (axisSize - insetByAxis[axis] * 2) / axisSize);
          const value = readBufferAxis(position, axis, index);
          writeBufferAxis(position, axis, index, center[axis] + (value - center[axis]) * scale);
        });
      }
      position.needsUpdate = true;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      mesh.userData.chuangshaScreenInsetApplied = true;
    }
    return getGeometryPlaneInfo(geometry);
  }

  function clearChuangshaGeneratedScreenOverlays(mesh) {
    for (let index = mesh.children.length - 1; index >= 0; index--) {
      const child = mesh.children[index];
      if (!child?.userData?.chuangshaGeneratedOverlay) continue;
      mesh.remove(child);
      child.geometry?.dispose?.();
    }
  }

  function applyChuangshaScreenUvs(mesh, planeInfo = getGeometryPlaneInfo(mesh.geometry)) {
    const geometry = mesh.geometry;
    if (!geometry?.attributes?.position) return;
    const { box, size, planeAxes } = planeInfo;
    const position = geometry.attributes.position;
    const uvs = [];
    for (let index = 0; index < position.count; index++) {
      const uValue = readBufferAxis(position, planeAxes[0], index);
      const vValue = readBufferAxis(position, planeAxes[1], index);
      const u = size[planeAxes[0]] > 0 ? (uValue - box.min[planeAxes[0]]) / size[planeAxes[0]] : 0;
      const v = size[planeAxes[1]] > 0 ? (vValue - box.min[planeAxes[1]]) / size[planeAxes[1]] : 0;
      uvs.push(u, v);
    }
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.attributes.uv.needsUpdate = true;
  }

  function addChuangshaScreenLines(mesh, lineMaterial, planeInfo = getGeometryPlaneInfo(mesh.geometry)) {
    if (!mesh?.geometry) return;
    const { box, size, planeAxes, flatAxis } = planeInfo;
    const majorAxis = planeAxes[0];
    const minorAxis = planeAxes[1];
    const majorMin = box.min[majorAxis];
    const majorMax = box.max[majorAxis];
    const minorMin = box.min[minorAxis];
    const minorMax = box.max[minorAxis];
    const flat = box.getCenter(new THREE.Vector3())[flatAxis] + 0.00035;
    const linePositions = [];

    const pushPoint = (major, minor) => {
      const point = { x: 0, y: 0, z: 0 };
      point[majorAxis] = major;
      point[minorAxis] = minor;
      point[flatAxis] = flat;
      linePositions.push(point.x, point.y, point.z);
    };

    const verticalCount = Math.max(48, Math.round(size[minorAxis] * 136));
    const horizontalCount = Math.max(64, Math.round(size[majorAxis] * 160));
    for (let index = 0; index <= verticalCount; index++) {
      const minor = THREE.MathUtils.lerp(minorMin, minorMax, index / verticalCount);
      pushPoint(majorMin, minor);
      pushPoint(majorMax, minor);
    }
    for (let index = 0; index <= horizontalCount; index++) {
      const major = THREE.MathUtils.lerp(majorMin, majorMax, index / horizontalCount);
      pushPoint(major, minorMin);
      pushPoint(major, minorMax);
    }
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    lines.name = "chuangsha_screen_threads";
    lines.renderOrder = 2;
    lines.userData.chuangshaGeneratedOverlay = true;
    mesh.add(lines);
  }

  function addChuangshaScreenInsetRetainers(mesh, frameMaterial, planeInfo = getGeometryPlaneInfo(mesh.geometry)) {
    const { box, size, planeAxes, flatAxis } = planeInfo;
    const majorAxis = planeAxes[0];
    const minorAxis = planeAxes[1];
    const center = box.getCenter(new THREE.Vector3());
    const shortSize = Math.min(size[majorAxis], size[minorAxis]);
    const bar = Math.max(0.01, Math.min(0.02, shortSize * 0.035));
    const depth = Math.max(0.004, Math.min(0.008, shortSize * 0.014));
    const flat = center[flatAxis] + depth * 0.3;

    const makeVector = (values) => new THREE.Vector3(values.x || 0, values.y || 0, values.z || 0);
    const makeBar = (name, dimensions, position) => {
      const barMesh = new THREE.Mesh(new THREE.BoxGeometry(dimensions.x, dimensions.y, dimensions.z), frameMaterial);
      barMesh.name = name;
      barMesh.position.copy(position);
      barMesh.castShadow = true;
      barMesh.receiveShadow = true;
      barMesh.renderOrder = 4;
      barMesh.userData.chuangshaGeneratedOverlay = true;
      mesh.add(barMesh);
    };

    const sideDimensions = { x: depth, y: depth, z: depth };
    sideDimensions[majorAxis] = size[majorAxis] + bar * 2;
    sideDimensions[minorAxis] = bar;
    sideDimensions[flatAxis] = depth;

    const capDimensions = { x: depth, y: depth, z: depth };
    capDimensions[majorAxis] = bar;
    capDimensions[minorAxis] = size[minorAxis] + bar * 2;
    capDimensions[flatAxis] = depth;

    const sideA = { x: center.x, y: center.y, z: center.z };
    sideA[minorAxis] = box.min[minorAxis] - bar * 0.45;
    sideA[flatAxis] = flat;
    const sideB = { ...sideA };
    sideB[minorAxis] = box.max[minorAxis] + bar * 0.45;
    makeBar("chuangsha_screen_retainer_side_a", makeVector(sideDimensions), makeVector(sideA));
    makeBar("chuangsha_screen_retainer_side_b", makeVector(sideDimensions), makeVector(sideB));

    const capA = { x: center.x, y: center.y, z: center.z };
    capA[majorAxis] = box.min[majorAxis] - bar * 0.45;
    capA[flatAxis] = flat;
    const capB = { ...capA };
    capB[majorAxis] = box.max[majorAxis] + bar * 0.45;
    makeBar("chuangsha_screen_retainer_cap_a", makeVector(capDimensions), makeVector(capA));
    makeBar("chuangsha_screen_retainer_cap_b", makeVector(capDimensions), makeVector(capB));
  }

  function addChuangshaControlOverlays(group, classification, materialSet) {
    const backing = classification?.backing;
    if (!backing) return;
    const existingDisplay = classification.parts.some((part) => part.role === "display_panel");
    const existingButton = classification.parts.some((part) => part.role === "control_button");
    if (existingDisplay && existingButton) return;

    const width = Math.max(backing.size.x, backing.size.z, 0.42);
    const height = Math.max(backing.size.y, 0.9);
    const depth = Math.max(Math.min(backing.size.x, backing.size.z), 0.035);
    const localMin = group.worldToLocal(backing.box.min.clone());
    const localMax = group.worldToLocal(backing.box.max.clone());
    const localCenter = group.worldToLocal(backing.center.clone());
    const bottomY = Math.min(localMin.y, localMax.y);
    const frontZ = Math.max(localMin.z, localMax.z) + Math.max(depth * 0.16, 0.012);
    const y = bottomY + Math.max(height * 0.055, 0.045);

    if (!existingDisplay) {
      const displaySize = new THREE.Vector3(
        width * 0.36,
        Math.max(height * 0.045, 0.036),
        Math.max(depth * 0.48, 0.018)
      );
      const display = new THREE.Mesh(
        new THREE.BoxGeometry(displaySize.x, displaySize.y, displaySize.z),
        materialSet.display
      );
      display.name = "chuangsha_display_panel";
      display.position.set(localCenter.x - width * 0.23, y, frontZ);
      display.castShadow = false;
      display.receiveShadow = false;
      display.renderOrder = 12;
      display.userData.chuangshaRole = "display_panel";
      display.userData.chuangshaGeneratedControl = true;
      if (scene.environment && display.material) {
        display.material.envMap = scene.environment;
        display.material.needsUpdate = true;
      }
      group.add(display);
      classification.parts.push({
        role: "display_panel",
        mesh: display,
        name: display.name,
        box: new THREE.Box3().setFromObject(display),
        center: display.getWorldPosition(new THREE.Vector3()),
        size: displaySize.clone()
      });
    }

    if (!existingButton) {
      const buttonSize = new THREE.Vector3(
        width * 0.078,
        Math.max(height * 0.040, 0.030),
        Math.max(depth * 0.58, 0.022)
      );
      const button = new THREE.Mesh(
        new THREE.BoxGeometry(buttonSize.x, buttonSize.y, buttonSize.z),
        materialSet.button
      );
      button.name = "chuangsha_control_button";
      button.position.set(localCenter.x + width * 0.055, y + height * 0.004, frontZ + depth * 0.04);
      button.castShadow = true;
      button.receiveShadow = true;
      button.renderOrder = 13;
      button.userData.chuangshaRole = "control_button";
      button.userData.chuangshaGeneratedControl = true;
      if (scene.environment && button.material) {
        button.material.envMap = scene.environment;
        button.material.needsUpdate = true;
      }
      group.add(button);
      classification.parts.push({
        role: "control_button",
        mesh: button,
        name: button.name,
        box: new THREE.Box3().setFromObject(button),
        center: button.getWorldPosition(new THREE.Vector3()),
        size: buttonSize.clone()
      });
    }
    group.updateMatrixWorld(true);
  }

  function applyChuangshaMaterials(group) {
    const materialSet = getChuangshaMaterialSet();
    const classification = classifyChuangshaParts(getChuangshaMeshSummaries(group));
    const preservedFrameMaterials = new Map();
    const getPreservedFrameMaterial = (mesh, role = "frame") => {
      if (!mesh) return materialSet.frame;
      if (preservedFrameMaterials.has(mesh.uuid)) return preservedFrameMaterials.get(mesh.uuid);
      const fallback = role === "black_label" ? materialSet.label : materialSet.frame;
      const clone = makeChuangshaTitaniumMaterial(mesh.material, fallback, {
        forceTitanium: role !== "black_label",
        minRoughness: role === "black_label" ? 0.48 : 0.1,
        maxRoughness: role === "black_label" ? 0.62 : 0.18,
        minMetalness: role === "black_label" ? 0.02 : 1,
        envMapIntensity: role === "black_label" ? 0.55 : 2.35,
        tintColor: role === "black_label" ? null : 0xd1d5d2,
        tintStrength: role === "black_label" ? 0 : 1,
        detailMap: role === "black_label" ? null : materialSet.titaniumTexture,
        clearcoat: role === "black_label" ? null : 0.36,
        clearcoatRoughness: role === "black_label" ? null : 0.2,
        anisotropy: role === "black_label" ? null : 0.72,
        anisotropyRotation: role === "black_label" ? null : Math.PI * 0.5
      });
      preservedFrameMaterials.set(mesh.uuid, clone);
      return clone;
    };
    const retainerSource = classification.parts.find((part) => part.role === "pull_bar")
      || classification.parts.find((part) => part.role === "static_backing")
      || classification.parts.find((part) => part.role === "drive_detail");
    const retainerMaterial = getPreservedFrameMaterial(retainerSource?.mesh);
    classification.parts.forEach((part) => {
      const mesh = part.mesh;
      const originalMaterial = mesh.material;
      mesh.userData.chuangshaRole = part.role;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      if (part.role === "screen") {
        clearChuangshaGeneratedScreenOverlays(mesh);
        const planeInfo = insetChuangshaScreenGeometry(mesh);
        applyChuangshaScreenUvs(mesh, planeInfo);
        mesh.material = materialSet.screen;
        mesh.renderOrder = 1;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        addChuangshaScreenLines(mesh, materialSet.lines, planeInfo);
        addChuangshaScreenInsetRetainers(mesh, retainerMaterial, planeInfo);
      } else if (part.role === "display_panel") {
        mesh.material = materialSet.display;
        mesh.renderOrder = 9;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      } else if (part.role === "control_button") {
        mesh.material = materialSet.button;
        mesh.renderOrder = 10;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      } else if (part.role === "black_label") {
        mesh.material = materialSet.label;
        mesh.renderOrder = 8;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      } else {
        mesh.material = getPreservedFrameMaterial(mesh);
      }
      disposeChuangshaLocalMaterial(originalMaterial);
      if (scene.environment && mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((mat) => {
          mat.envMap = scene.environment;
          mat.envMapIntensity = mat.envMapIntensity ?? (part.role === "screen" ? 0.35 : 0.85);
          mat.needsUpdate = true;
        });
      }
    });
    addChuangshaControlOverlays(group, classification, materialSet);
    return classification;
  }

  function smoothChuangshaMotion(value) {
    const t = Math.max(0, Math.min(1, value || 0));
    return t * t * (3 - 2 * t);
  }

  function buildChuangshaMotionRig(group, classification) {
    const backingHeight = Math.max(classification?.backing?.size?.y || 0, 0.8);
    const travelY = Math.max(0.26, Math.min(0.72, backingHeight * 0.42));
    const parts = (classification?.parts || [])
      .filter((part) => ["screen", "pull_bar", "black_label", "display_panel", "control_button", "drive_detail"].includes(part.role))
      .map((part) => ({
        role: part.role,
        mesh: part.mesh,
        basePosition: part.mesh.position.clone(),
        baseRotation: part.mesh.rotation.clone(),
        baseScale: part.mesh.scale.clone()
      }));

    group.userData.chuangshaMotionRig = {
      kind: "vertical-retractable-screen",
      openAxis: "local-y",
      openTravel: travelY,
      parts
    };
    return group.userData.chuangshaMotionRig;
  }

  function getChuangshaMotionGroups(tag = null) {
    const tagText = tag == null ? null : String(tag);
    return Array.from(windowReplacementGroups).filter((group) => (
      group.parent &&
      group.userData.replacementAsset === "chuangsha" &&
      (!tagText || String(group.userData.replacedWindowTag || "") === tagText)
    ));
  }

  function getChuangshaOpenStateAt(elapsedSeconds = 0) {
    const elapsed = Number(elapsedSeconds) || 0;
    if (elapsed < 36 || elapsed > 46) return { open: 0, release: 0, stage: "closed" };
    if (elapsed < 39) {
      const t = smoothChuangshaMotion((elapsed - 36) / 3);
      return { open: t * 0.15, release: t, stage: "lock-release" };
    }
    if (elapsed < 43) {
      const t = smoothChuangshaMotion((elapsed - 39) / 4);
      return { open: 0.15 + t * 0.85, release: 1 - t * 0.45, stage: "opening" };
    }
    if (elapsed < 43.5) return { open: 1, release: 0.16, stage: "open-hold" };
    if (elapsed < 46) {
      const close = smoothChuangshaMotion((elapsed - 43.5) / 2.5);
      return { open: 1 - close, release: 0, stage: "closing" };
    }
    return { open: 0, release: 0, stage: "closed" };
  }

  function applyChuangshaMotionToGroup(group, openAmount = 0, releaseAmount = 0) {
    const rig = group?.userData?.chuangshaMotionRig;
    if (!rig?.parts?.length) return false;
    const open = smoothChuangshaMotion(openAmount);
    const release = smoothChuangshaMotion(releaseAmount);
    const travel = rig.openTravel * open;

    rig.parts.forEach((part) => {
      const mesh = part.mesh;
      if (!mesh?.parent) return;
      mesh.position.copy(part.basePosition);
      mesh.rotation.copy(part.baseRotation);
      mesh.scale.copy(part.baseScale);

      if (part.role === "screen") {
        mesh.position.y += travel * 0.47;
        mesh.scale.y *= Math.max(0.18, 1 - open * 0.78);
        mesh.scale.x *= Math.max(0.92, 1 - open * 0.05);
      } else if (part.role === "pull_bar") {
        mesh.position.y += travel;
        mesh.rotation.z += release * -0.08;
      } else if (part.role === "black_label" || part.role === "display_panel" || part.role === "control_button") {
        mesh.position.y += travel * 0.96;
        mesh.rotation.z += release * (part.role === "control_button" ? -0.025 : -0.05);
      } else if (part.role === "drive_detail") {
        mesh.position.y += travel * 0.18;
        mesh.rotation.z += release * 0.025;
      }
      mesh.updateMatrixWorld(true);
    });
    return true;
  }

  function setChuangshaProductMotionAtTime(tag, elapsedSeconds = 0) {
    const state = getChuangshaOpenStateAt(elapsedSeconds);
    let changed = false;
    getChuangshaMotionGroups(tag).forEach((group) => {
      changed = applyChuangshaMotionToGroup(group, state.open, state.release) || changed;
      group.userData.chuangshaMotionState = state;
    });
    if (typeof document !== "undefined" && document.body) {
      document.body.dataset.chuangshaMotionState = JSON.stringify({
        tag: tag == null ? null : String(tag),
        elapsed: +Number(elapsedSeconds || 0).toFixed(2),
        stage: state.stage,
        open: +Number(state.open || 0).toFixed(3),
        release: +Number(state.release || 0).toFixed(3)
      });
    }
    if (changed) markDirty();
    return state;
  }

  function resetChuangshaProductMotion(tag = null) {
    let changed = false;
    getChuangshaMotionGroups(tag).forEach((group) => {
      changed = applyChuangshaMotionToGroup(group, 0, 0) || changed;
      group.userData.chuangshaMotionState = { open: 0, release: 0, stage: "closed" };
    });
    if (typeof document !== "undefined" && document.body) {
      document.body.dataset.chuangshaMotionState = JSON.stringify({
        tag: tag == null ? null : String(tag),
        elapsed: 0,
        stage: "closed",
        open: 0,
        release: 0
      });
    }
    if (changed) markDirty();
  }

  function loadChuangshaWindowAsset(url = "./chuangsha.glb") {
    const absUrl = new URL(url, location.href).href;
    if (windowAssetCache.has(absUrl)) return windowAssetCache.get(absUrl);
    const promise = new Promise((resolve, reject) => {
      gltfLoader.load(
        absUrl,
        (gltf) => {
          const source = gltf.scene;
          source.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(source);
          if (!finiteBox(box)) {
            reject(new Error(`chuangsha GLB has no finite bounds: ${url}`));
            return;
          }
          resolve({ url: absUrl, root: source, box: box.clone(), size: box.getSize(new THREE.Vector3()) });
        },
        undefined,
        (err) => reject(new Error(`chuangsha GLB failed for "${url}": ${err.message || err}`))
      );
    });
    windowAssetCache.set(absUrl, promise);
    return promise;
  }

  function prepareChuangshaWindowInstance(asset) {
    const wrapper = new THREE.Group();
    wrapper.name = "replacement:window:chuangsha";
    const content = asset.root.clone(true);
    content.traverse((node) => {
      if (node.isMesh && node.geometry?.clone) node.geometry = node.geometry.clone();
    });
    wrapper.add(content);
    wrapper.updateMatrixWorld(true);
    const sourceBox = new THREE.Box3().setFromObject(wrapper);
    const sourceCenter = sourceBox.getCenter(new THREE.Vector3());
    content.position.sub(new THREE.Vector3(sourceCenter.x, sourceBox.min.y, sourceCenter.z));
    wrapper.updateMatrixWorld(true);
    const classification = applyChuangshaMaterials(wrapper);
    buildChuangshaMotionRig(wrapper, classification);
    return wrapper;
  }

  function getSceneHorizontalCenter() {
    const box = new THREE.Box3().setFromObject(root);
    if (!finiteBox(box)) return new THREE.Vector3(0, 0, 0);
    return box.getCenter(new THREE.Vector3());
  }

  function fitChuangshaWindowToBox(group, targetBox, sceneCenter, options = {}) {
    const targetCenter = targetBox.getCenter(new THREE.Vector3());
    const targetSize = targetBox.getSize(new THREE.Vector3());
    const widthAxis = targetSize.x >= targetSize.z ? "x" : "z";
    const depthAxis = widthAxis === "x" ? "z" : "x";
    const inward = sceneCenter.clone().sub(targetCenter);
    const inwardSign = inward[depthAxis] >= 0 ? 1 : -1;
    const rotationY = widthAxis === "x"
      ? (inwardSign >= 0 ? 0 : Math.PI)
      : (inwardSign >= 0 ? Math.PI / 2 : -Math.PI / 2);

    group.position.set(0, 0, 0);
    group.rotation.set(0, 0, 0);
    group.scale.set(1, 1, 1);
    group.updateMatrixWorld(true);
    const sourceBox = new THREE.Box3().setFromObject(group);
    const sourceSize = sourceBox.getSize(new THREE.Vector3());
    const fitPadding = options.padding ?? 0.985;
    const depthPadding = options.depthPadding ?? 0.92;
    const targetDepth = Math.min(
      Math.max(targetSize[depthAxis] * (options.depthFill ?? 0.32), options.minDepth ?? 0.052),
      options.maxDepth ?? 0.12,
      Math.max(targetSize[depthAxis] * 0.96, options.minDepth ?? 0.052)
    );
    const sx = (targetSize[widthAxis] / Math.max(sourceSize.x, 0.001)) * fitPadding;
    const sy = (targetSize.y / Math.max(sourceSize.y, 0.001)) * (options.heightPadding ?? 0.985);
    const sz = (targetDepth / Math.max(sourceSize.z, 0.001)) * depthPadding;
    group.rotation.set(0, rotationY, 0);
    group.scale.set(Math.max(sx, 0.001), Math.max(sy, 0.001), Math.max(sz, 0.001));
    group.updateMatrixWorld(true);

    const scaledBox = new THREE.Box3().setFromObject(group);
    const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
    group.position.set(
      targetCenter.x - scaledCenter.x,
      targetCenter.y - scaledCenter.y,
      targetCenter.z - scaledCenter.z
    );
    group.updateMatrixWorld(true);
    return {
      rotationY,
      widthAxis,
      depthAxis,
      scale: group.scale.toArray().map((n) => +n.toFixed(4)),
      targetDepth: +targetDepth.toFixed(4),
      targetBox: boxSnapshot(targetBox),
      fittedBox: boxSnapshot(new THREE.Box3().setFromObject(group))
    };
  }

  function collectWindowReplacementTargets(tags = []) {
    const tagSet = new Set(tags.map((tag) => String(tag)));
    const byTag = new Map();
    root.traverse((obj) => {
      if (!isWindowMesh(obj) || obj.userData._windowReplacementHidden) return;
      const tag = obj.userData.windowTag != null ? String(obj.userData.windowTag) : null;
      if (!tag || !tagSet.has(tag)) return;
      const box = new THREE.Box3().setFromObject(obj);
      if (!finiteBox(box)) return;
      let item = byTag.get(tag);
      if (!item) {
        item = {
          tag,
          expressID: obj.userData.expressID ?? null,
          ifcType: obj.userData.ifcType,
          name: obj.userData.windowName || null,
          objectType: obj.userData.windowObjectType || null,
          meshes: [],
          box: new THREE.Box3()
        };
        byTag.set(tag, item);
      }
      item.meshes.push(obj);
      item.box.union(box);
    });
    return Array.from(byTag.values()).sort((a, b) => String(a.tag).localeCompare(String(b.tag)));
  }

  function debugWindowReplacementTargets(tags = ["181930", "182101"]) {
    return collectWindowReplacementTargets(tags).map((item) => ({
      tag: item.tag,
      expressID: item.expressID,
      name: item.name,
      objectType: item.objectType,
      meshCount: item.meshes.length,
      box: boxSnapshot(item.box)
    }));
  }

  function unionRoleBox(roleBoxes, role, box) {
    if (!role || !finiteBox(box)) return;
    const current = roleBoxes.get(role);
    if (current) current.union(box);
    else roleBoxes.set(role, box.clone());
  }

  function makeChuangshaAnchor(center, radius, box = null) {
    return {
      center: center.clone(),
      radius: Math.max(0.04, Number(radius) || 0.04),
      box: finiteBox(box) ? box.clone() : null
    };
  }

  function makeChuangshaAnchorFromBox(box, fallbackCenter = null, radiusScale = 0.28) {
    if (finiteBox(box)) {
      const size = box.getSize(new THREE.Vector3());
      return makeChuangshaAnchor(
        box.getCenter(new THREE.Vector3()),
        Math.max(size.x, size.y, size.z, size.length() * radiusScale),
        box
      );
    }
    return makeChuangshaAnchor(fallbackCenter || new THREE.Vector3(), 0.12, null);
  }

  function buildChuangshaProductSemantics(item) {
    const roleBoxes = new Map();
    item.group.updateMatrixWorld(true);
    item.group.traverse((obj) => {
      if (!obj?.isMesh) return;
      const role = obj.userData.chuangshaRole;
      if (!role) return;
      const worldBox = new THREE.Box3().setFromObject(obj);
      unionRoleBox(roleBoxes, role, worldBox);
    });

    const frameBox = roleBoxes.get("static_backing") || item.box;
    const screenBox = roleBoxes.get("screen") || null;
    const displayBox = roleBoxes.get("display_panel") || null;
    const buttonBox = roleBoxes.get("control_button") || null;
    const pullBarBox = roleBoxes.get("pull_bar") || null;
    const height = Math.max(item.size.y, 0.8);
    const width = Math.max(item.size[item.widthAxis], 0.5);

    const topCenter = item.center.clone().addScaledVector(new THREE.Vector3(0, 1, 0), Math.max(0.04, height * 0.42));
    topCenter.y = Math.min(topCenter.y, item.box.max.y - Math.max(0.02, height * 0.03));
    const bottomCenter = item.center.clone().addScaledVector(new THREE.Vector3(0, 1, 0), -Math.max(0.04, height * 0.42));
    bottomCenter.y = Math.max(bottomCenter.y, item.box.min.y + Math.max(0.02, height * 0.03));

    return {
      rolesPresent: Array.from(roleBoxes.keys()),
      anchors: {
        window: makeChuangshaAnchorFromBox(item.box, item.center, 0.18),
        room: makeChuangshaAnchor(item.center, Math.max(height * 0.92, width * 0.92), item.box),
        frame: makeChuangshaAnchorFromBox(frameBox, item.center, 0.16),
        screen: makeChuangshaAnchorFromBox(screenBox || frameBox, item.center, 0.18),
        display: makeChuangshaAnchorFromBox(
          displayBox,
          item.center.clone()
            .addScaledVector(item.inward, Math.max(0.01, item.size[item.depthAxis] * 0.12))
            .addScaledVector(item.lateral, -width * 0.16)
            .addScaledVector(new THREE.Vector3(0, 1, 0), -height * 0.42),
          0.34
        ),
        button: makeChuangshaAnchorFromBox(
          buttonBox,
          item.center.clone()
            .addScaledVector(item.inward, Math.max(0.01, item.size[item.depthAxis] * 0.14))
            .addScaledVector(item.lateral, width * 0.08)
            .addScaledVector(new THREE.Vector3(0, 1, 0), -height * 0.42),
          0.44
        ),
        handle: makeChuangshaAnchorFromBox(
          pullBarBox || buttonBox || displayBox || frameBox,
          item.center,
          0.22
        ),
        track: makeChuangshaAnchorFromBox(frameBox, item.center, 0.24),
        top: makeChuangshaAnchor(topCenter, Math.max(0.08, width * 0.26), null),
        bottom: makeChuangshaAnchor(bottomCenter, Math.max(0.08, width * 0.26), null)
      }
    };
  }

  function resolveChuangshaFocusAnchor(item, focusKey = "window") {
    const focus = String(focusKey || "window").toLowerCase();
    const anchors = item.semanticAnchors?.anchors || {};
    const height = Math.max(item.size.y, 0.8);
    const detailMax = Math.max(0.5, Math.min(1.28, height * 0.62));
    const wholeMin = Math.max(0.52, Math.min(0.96, height * 0.28));
    const wholeMax = Math.max(1.2, Math.min(2.8, height * 1.55));
    const detailMin = Math.max(0.2, Math.min(0.42, height * 0.16));
    const makeFocus = (key, label, anchor, options = {}) => ({
      key,
      label,
      anchor,
      tolerance: Math.max(0.08, options.tolerance ?? anchor?.radius ?? 0.12),
      detail: !!options.detail,
      whole: !!options.whole,
      idealMin: Math.max(0, options.idealMin ?? 0),
      idealMax: Math.max(0.12, options.idealMax ?? Number.POSITIVE_INFINITY),
      insideOnly: options.insideOnly !== false
    });
    switch (focus) {
      case "frame":
        return makeFocus("frame", "frame", anchors.frame || anchors.window, {
          whole: true,
          tolerance: (anchors.frame?.radius || anchors.window?.radius || 0.18) * 0.52,
          idealMin: wholeMin,
          idealMax: wholeMax
        });
      case "mesh":
      case "screen":
        return makeFocus("screen", "screen", anchors.screen || anchors.window, {
          detail: true,
          tolerance: (anchors.screen?.radius || anchors.window?.radius || 0.14) * 0.72,
          idealMin: detailMin,
          idealMax: detailMax
        });
      case "display":
        return makeFocus("display", "display", anchors.display || anchors.bottom || anchors.window, {
          detail: true,
          tolerance: (anchors.display?.radius || anchors.bottom?.radius || 0.1) * 0.95,
          idealMin: detailMin,
          idealMax: Math.min(detailMax, 0.92)
        });
      case "button":
        return makeFocus("button", "button", anchors.button || anchors.bottom || anchors.window, {
          detail: true,
          tolerance: (anchors.button?.radius || anchors.bottom?.radius || 0.1) * 1.15,
          idealMin: detailMin,
          idealMax: Math.min(detailMax, 0.86)
        });
      case "handle":
        return makeFocus("handle", "handle", anchors.handle || anchors.button || anchors.window, {
          detail: true,
          tolerance: (anchors.handle?.radius || anchors.button?.radius || 0.12) * 0.92,
          idealMin: detailMin,
          idealMax: detailMax
        });
      case "track":
        return makeFocus("track", "track", anchors.track || anchors.frame || anchors.window, {
          whole: true,
          tolerance: (anchors.track?.radius || anchors.frame?.radius || 0.16) * 0.6,
          idealMin: wholeMin * 0.95,
          idealMax: wholeMax
        });
      case "top":
        return makeFocus("top", "top edge", anchors.top || anchors.frame || anchors.window, {
          detail: true,
          tolerance: (anchors.top?.radius || anchors.frame?.radius || 0.12) * 1.05,
          idealMin: detailMin,
          idealMax: detailMax
        });
      case "bottom":
        return makeFocus("bottom", "bottom rail", anchors.bottom || anchors.display || anchors.window, {
          detail: true,
          tolerance: (anchors.bottom?.radius || anchors.display?.radius || 0.12) * 1.02,
          idealMin: detailMin,
          idealMax: detailMax
        });
      case "room":
        return makeFocus("room", "window in room", anchors.room || anchors.window, {
          whole: true,
          tolerance: (anchors.room?.radius || anchors.window?.radius || 0.2) * 0.64,
          idealMin: wholeMin,
          idealMax: wholeMax * 1.15
        });
      case "outside":
        return makeFocus("outside", "outside view", anchors.window || anchors.room, {
          whole: true,
          tolerance: (anchors.window?.radius || 0.18) * 0.85,
          idealMin: wholeMin,
          idealMax: wholeMax,
          insideOnly: false
        });
      case "window":
      default:
        return makeFocus("window", "window", anchors.window || anchors.frame, {
          whole: true,
          tolerance: (anchors.window?.radius || anchors.frame?.radius || 0.18) * 0.55,
          idealMin: wholeMin,
          idealMax: wholeMax
        });
    }
  }

  function invalidateChuangshaProductCache() {
    chuangshaProductCache = null;
  }

  function collectChuangshaWindowProducts(tags = []) {
    const tagSet = tags?.length ? new Set(tags.map((tag) => String(tag))) : null;
    if (!chuangshaProductCache) {
      const sceneCenter = getSceneHorizontalCenter();
      chuangshaProductCache = Array.from(windowReplacementGroups)
        .filter((group) => group.parent && group.userData.replacementAsset === "chuangsha")
        .map((group) => {
          const box = new THREE.Box3().setFromObject(group);
          if (!finiteBox(box)) return null;
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const tag = String(group.userData.replacedWindowTag || "");
          const depthAxis = group.userData.chuangshaDepthAxis || (size.x < size.z ? "x" : "z");
          const widthAxis = depthAxis === "x" ? "z" : "x";
          const inward = new THREE.Vector3();
          const depthSign = Math.sign(sceneCenter[depthAxis] - center[depthAxis]) || -1;
          inward[depthAxis] = depthSign;
          const lateral = new THREE.Vector3(-inward.z, 0, inward.x).normalize();
          const item = {
            group,
            tag,
            depthAxis,
            widthAxis,
            rotationY: group.userData.chuangshaRotationY ?? 0,
            box,
            center,
            size,
            inward,
            lateral
          };
          item.semanticAnchors = buildChuangshaProductSemantics(item);
          return item;
        })
        .filter(Boolean)
        .sort((a, b) => a.center.z - b.center.z || a.center.x - b.center.x || a.tag.localeCompare(b.tag));
    }
    return chuangshaProductCache
      .filter((item) => !tagSet || tagSet.has(String(item.tag)));
  }

  function offsetForProduct(item, inward, lateral, up, depth = 0, side = 0, lift = 0) {
    return item.center.clone()
      .addScaledVector(inward, depth)
      .addScaledVector(lateral, side)
      .addScaledVector(up, lift);
  }

  function makeChuangshaProductTourWaypoint(label, item, position, target, duration, hold = 0, fov = null) {
    const wp = makeTourWaypoint(label, position, target, duration);
    wp.hold = hold;
    wp.productTag = item.tag;
    wp.tourKind = "chuangshaProduct";
    if (Number.isFinite(fov)) wp.fov = fov;
    return wp;
  }

  function buildChuangshaProductTour(options = {}) {
    const products = collectChuangshaWindowProducts(options.tags || ["181930", "182101"]);
    if (!products.length) {
      lastObjectTourDebug = {
        source: "chuangsha-product-tour-empty",
        reason: "no-chuangsha-window-replacements",
        waypoints: []
      };
      return [];
    }

    const item = options.tag
      ? products.find((product) => product.tag === String(options.tag)) || products[0]
      : products[0];
    const sceneCenter = getSceneHorizontalCenter();
    const inward = new THREE.Vector3();
    const depthAxis = item.depthAxis === "z" ? "z" : "x";
    const depthSign = Math.sign(sceneCenter[depthAxis] - item.center[depthAxis]) || -1;
    inward[depthAxis] = depthSign;
    const lateral = new THREE.Vector3(-inward.z, 0, inward.x).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const halfWidth = Math.max(0.34, Math.min(0.62, item.size[item.widthAxis] * 0.5));
    const halfHeight = Math.max(0.82, item.size.y * 0.5);
    const face = item.center.clone();
    const macro = Math.max(0.34, Math.min(0.46, item.size.y * 0.18));
    const detail = Math.max(0.5, Math.min(0.66, item.size.y * 0.27));
    const mid = Math.max(0.78, Math.min(0.98, item.size.y * 0.4));
    const wide = Math.max(1.08, Math.min(1.3, item.size.y * 0.58));
    const look = (side = 0, lift = 0, depth = 0.035) => face.clone()
      .addScaledVector(lateral, side)
      .addScaledVector(up, lift)
      .addScaledVector(inward, depth);
    const outside = (depth) => -Math.abs(depth);
    const shot = ({
      label,
      depth,
      side = 0,
      lift = 0,
      targetSide = 0,
      targetLift = 0,
      targetDepth = 0.035,
      duration = 3,
      hold = 0.04,
      fov = null,
      focus = "",
      script = "",
      beat = ""
    }) => {
      const wp = makeChuangshaProductTourWaypoint(
        label,
        item,
        offsetForProduct(item, inward, lateral, up, depth, side, lift),
        look(targetSide, targetLift, targetDepth),
        duration,
        hold,
        fov
      );
      if (focus) wp.focus = focus;
      if (script) wp.script = script;
      if (beat) wp.beat = beat;
      return wp;
    };

    const waypoints = [
      shot({
        label: "外景定场",
        depth: outside(wide * 1.08),
        side: -halfWidth * 0.12,
        lift: halfHeight * 0.12,
        targetLift: halfHeight * 0.05,
        targetDepth: outside(0.04),
        duration: 3.0,
        hold: 0.18,
        fov: 34,
        focus: "整扇窗的比例、白墙边界、窗纱轮廓",
        script: "先把整扇窗作为产品主角稳稳放进画面，交代它在白墙中的位置和比例，不抢细节，只建立高级、安静、干净的第一印象。"
      }),
      shot({
        label: "外景左上扫边",
        depth: outside(wide * 0.98),
        side: -halfWidth * 0.28,
        lift: halfHeight * 0.44,
        targetSide: -halfWidth * 0.10,
        targetLift: halfHeight * 0.30,
        targetDepth: outside(0.038),
        duration: 2.5,
        hold: 0.06,
        fov: 32,
        focus: "左上角转折、顶边收口",
        script: "顺着左上角轻轻绕入，让窗框上沿和左上转角先被读出来，像产品摄影里先交代轮廓，再把结构关系慢慢展开。"
      }),
      shot({
        label: "外景右上横移",
        depth: outside(wide * 0.94),
        side: halfWidth * 0.28,
        lift: halfHeight * 0.40,
        targetSide: halfWidth * 0.08,
        targetLift: halfHeight * 0.26,
        targetDepth: outside(0.038),
        duration: 2.5,
        hold: 0.05,
        fov: 31,
        focus: "右上角、横向线条、窗框厚度",
        script: "从另一侧把上沿横向扫过去，让观众确认它不是一块平面贴图，而是有真实窗框厚度和金属收边的实体。"
      }),
      shot({
        label: "外景中轴缓推",
        depth: outside(mid * 0.96),
        side: halfWidth * 0.10,
        lift: halfHeight * 0.14,
        targetSide: 0,
        targetLift: halfHeight * 0.04,
        targetDepth: outside(0.032),
        duration: 2.8,
        hold: 0.08,
        fov: 30,
        focus: "窗面中心、纱网层次",
        script: "镜头收回到中轴，开始正式看窗面本体，让纱网的层次和框体的分界进入可读状态。"
      }),
      shot({
        label: "窗框顶沿贴近",
        depth: outside(mid * 0.90),
        side: 0,
        lift: halfHeight * 0.70,
        targetSide: 0,
        targetLift: halfHeight * 0.36,
        targetDepth: outside(0.03),
        duration: 2.5,
        hold: 0.08,
        fov: 28,
        focus: "顶部金属盒、上沿收口",
        script: "把镜头抬到顶沿附近，重点看顶部金属盒与上框的咬合关系，让高端感先从结构上被看见。"
      }),
      shot({
        label: "左立边质感",
        depth: outside(detail * 0.92),
        side: -halfWidth * 0.42,
        lift: halfHeight * 0.08,
        targetSide: -halfWidth * 0.30,
        targetLift: halfHeight * 0.02,
        targetDepth: outside(0.024),
        duration: 2.4,
        hold: 0.05,
        fov: 26,
        focus: "左侧立边、嵌入感、边缘干净度",
        script: "贴着左立边掠过去，强调边缘干净、嵌入到位、没有多余线条外露，像做工好的产品展示那样克制。"
      }),
      shot({
        label: "右立边质感",
        depth: outside(detail * 0.92),
        side: halfWidth * 0.42,
        lift: halfHeight * 0.06,
        targetSide: halfWidth * 0.30,
        targetLift: 0,
        targetDepth: outside(0.024),
        duration: 2.4,
        hold: 0.05,
        fov: 26,
        focus: "右侧立边、对称关系、封边完整性",
        script: "再换到右立边做一次对称验证，把窗体的完整性和两侧封边的统一性讲清楚。"
      }),
      shot({
        label: "下沿预备",
        depth: outside(detail * 0.90),
        side: 0,
        lift: -halfHeight * 0.30,
        targetSide: 0,
        targetLift: -halfHeight * 0.22,
        targetDepth: outside(0.03),
        duration: 2.5,
        hold: 0.08,
        fov: 25,
        focus: "下沿、底部开口、即将穿入的位置",
        script: "镜头放低，先把下沿和底部开口交代出来，给后面穿入动作一个明确的前奏。"
      }),
      shot({
        label: "下沿停驻",
        depth: outside(detail * 0.84),
        side: -halfWidth * 0.02,
        lift: -halfHeight * 0.42,
        targetSide: 0,
        targetLift: -halfHeight * 0.34,
        targetDepth: outside(0.025),
        duration: 2.2,
        hold: 0.12,
        fov: 24,
        focus: "底口、封边、过渡位置",
        script: "在底口前故意停一拍，把观众的视线压到最接近穿入点的位置，确保后面的切入有足够的情绪和节奏。"
      }),
      shot({
        label: "穿入前对齐",
        depth: outside(detail * 0.80),
        side: 0,
        lift: -halfHeight * 0.48,
        targetSide: 0,
        targetLift: -halfHeight * 0.40,
        targetDepth: outside(0.024),
        duration: 2.8,
        hold: 0.04,
        fov: 23,
        focus: "底部通道、镜头通行方向",
        script: "镜头压低到和底部通道同一高度，先对齐通行方向，再准备从打开的底部穿过去，不碰墙，不切门。"
      }),
      shot({
        label: "从底部穿入",
        depth: detail * 0.86,
        side: 0,
        lift: -halfHeight * 0.46,
        targetSide: 0,
        targetLift: -halfHeight * 0.38,
        targetDepth: 0.024,
        duration: 3.8,
        hold: 0.04,
        fov: 23,
        focus: "穿过底部开口后的室内第一视角",
        script: "顺着打开的底部平滑穿入室内，保持镜头连续，不要飞出房间，也不要让视线去追无关的墙面。"
      }),
      shot({
        label: "室内落位",
        depth: mid * 0.96,
        side: halfWidth * 0.04,
        lift: -halfHeight * 0.24,
        targetSide: 0,
        targetLift: -halfHeight * 0.16,
        targetDepth: 0.032,
        duration: 2.8,
        hold: 0.10,
        fov: 26,
        focus: "室内视角、窗体关系、落地稳定感",
        script: "进入室内后先稳住，给观众一点适应时间，再把窗体重新作为画面主角交回来。"
      }),
      shot({
        label: "室内整体一眼",
        depth: wide * 1.00,
        side: 0,
        lift: halfHeight * 0.08,
        targetSide: 0,
        targetLift: halfHeight * 0.04,
        targetDepth: 0.04,
        duration: 3.0,
        hold: 0.12,
        fov: 30,
        focus: "完整窗体、纱网、框体关系",
        script: "后撤半步，让整个窗的完整关系落进画面，像产品大片里的 hero shot，先看全貌，再看细节。"
      }),
      shot({
        label: "室内左侧留白",
        depth: wide * 0.92,
        side: -halfWidth * 0.30,
        lift: halfHeight * 0.06,
        targetSide: -halfWidth * 0.10,
        targetLift: halfHeight * 0.02,
        targetDepth: 0.04,
        duration: 2.4,
        hold: 0.05,
        fov: 29,
        focus: "左侧边界、深度感、内外层次",
        script: "向左做一点点平移，用轻微视差把窗体和空间拉开，让产品不是平贴在画面里，而是站在空间中。"
      }),
      shot({
        label: "室内右侧留白",
        depth: wide * 0.90,
        side: halfWidth * 0.32,
        lift: halfHeight * 0.04,
        targetSide: halfWidth * 0.10,
        targetLift: 0,
        targetDepth: 0.04,
        duration: 2.4,
        hold: 0.05,
        fov: 29,
        focus: "右侧边界、对称回味、安装边缘",
        script: "再向右轻轻挪一下，让左右边缘都被看见，补齐产品的对称感和安装后的完整度。"
      }),
      shot({
        label: "室内俯视检视",
        depth: mid * 0.90,
        side: halfWidth * 0.08,
        lift: halfHeight * 0.76,
        targetSide: 0,
        targetLift: halfHeight * 0.28,
        targetDepth: 0.032,
        duration: 2.8,
        hold: 0.06,
        fov: 27,
        focus: "安装厚度、边框层级、上中下结构",
        script: "抬高视角做一次俯视检视，让安装厚度、层级关系和上下结构一口气都能看明白。"
      }),
      shot({
        label: "顶盒近景",
        depth: detail * 0.98,
        side: halfWidth * 0.16,
        lift: halfHeight * 0.46,
        targetSide: halfWidth * 0.04,
        targetLift: halfHeight * 0.40,
        targetDepth: 0.026,
        duration: 2.6,
        hold: 0.08,
        fov: 24,
        focus: "顶部金属盒、收纳感、高级结构",
        script: "把镜头推到顶部盒体，讲清楚高级感是怎么来的：不是花哨，而是结构收得干净、厚度控制得克制。"
      }),
      shot({
        label: "窗网微距",
        depth: macro * 0.92,
        side: -halfWidth * 0.08,
        lift: halfHeight * 0.10,
        targetSide: -halfWidth * 0.02,
        targetLift: halfHeight * 0.04,
        targetDepth: 0.022,
        duration: 3.2,
        hold: 0.10,
        fov: 20,
        focus: "窗网纹理、孔格、透光质感",
        script: "把焦点压到纱网上，近距离看它的纹理、透光和边缘干净度，这是产品细节最容易打动人的地方。"
      }),
      shot({
        label: "嵌入金属条",
        depth: detail * 0.88,
        side: -halfWidth * 0.44,
        lift: -halfHeight * 0.04,
        targetSide: -halfWidth * 0.32,
        targetLift: -halfHeight * 0.02,
        targetDepth: 0.026,
        duration: 2.5,
        hold: 0.06,
        fov: 22,
        focus: "纱网嵌入金属条的关系",
        script: "专门证明纱网是嵌在金属条里的，不是浮起来的，也不是外贴的，让结构关系一眼看懂。"
      }),
      shot({
        label: "导轨深度",
        depth: detail * 0.92,
        side: halfWidth * 0.44,
        lift: -halfHeight * 0.08,
        targetSide: halfWidth * 0.32,
        targetLift: -halfHeight * 0.05,
        targetDepth: 0.028,
        duration: 2.5,
        hold: 0.05,
        fov: 23,
        focus: "侧向导轨、咬合深度、封边",
        script: "扫过侧向导轨，继续把边缘对比度拉出来，确认封边和咬合深度都是完整的。"
      }),
      shot({
        label: "底部收边",
        depth: detail * 0.96,
        side: 0,
        lift: -halfHeight * 0.44,
        targetSide: 0,
        targetLift: -halfHeight * 0.38,
        targetDepth: 0.026,
        duration: 2.6,
        hold: 0.08,
        fov: 21,
        focus: "底部封口、手感位置、收边完成度",
        script: "回到底部收边，把手感位置和封口关系交代清楚，给安装完成度一个最后的证据镜头。"
      }),
      shot({
        label: "退后回看",
        depth: mid * 1.02,
        side: halfWidth * 0.10,
        lift: -halfHeight * 0.10,
        targetSide: 0,
        targetLift: -halfHeight * 0.04,
        targetDepth: 0.04,
        duration: 2.8,
        hold: 0.05,
        fov: 28,
        focus: "细节收束、整体回看",
        script: "再退后一点，把刚才看到的所有细节收束成一个整体，观众会更容易接受它是一个完整、精致的产品。"
      }),
      shot({
        label: "终章英雄",
        depth: wide,
        side: 0,
        lift: halfHeight * 0.08,
        targetSide: 0,
        targetLift: halfHeight * 0.04,
        targetDepth: 0.04,
        duration: 3.2,
        hold: 0.22,
        fov: 32,
        focus: "最终整体英雄镜头",
        script: "最后停成一个安静、稳定、可交付的英雄镜头，让产品的全貌和细节都落得住。"
      })
    ];

    waypoints.splice(11, waypoints.length - 11,
      shot({
        at: 34,
        label: "12 开合前稳定预备",
        depth: mid * 0.98,
        side: halfWidth * 0.10,
        lift: -halfHeight * 0.22,
        targetSide: 0,
        targetLift: -halfHeight * 0.22,
        targetDepth: 0.03,
        duration: 1,
        hold: 0.1,
        fov: 25,
        beat: "settle before motion",
        focus: "待操作状态、底部拉杆、窗面整体",
        script: "动作开始前先稳一下，让观众知道马上要进入开合流程，画面中心锁定拉杆和纱网下沿。"
      }),
      shot({
        at: 35,
        label: "13 底部仰视准备",
        depth: mid * 0.96,
        side: halfWidth * 0.12,
        lift: -halfHeight * 0.66,
        targetSide: 0,
        targetLift: -halfHeight * 0.34,
        targetDepth: 0.032,
        duration: 2,
        fov: 25,
        beat: "bottom view",
        motionCue: { stage: "closed-to-release", open: 0 },
        focus: "底部滑轨、下沿密封、拉杆起点",
        script: "先从底部仰视进入，把下沿滑轨、密封条和拉杆起点交代清楚。"
      }),
      shot({
        at: 37,
        label: "14 底部局部特写",
        depth: detail * 0.98,
        side: halfWidth * 0.12,
        lift: -halfHeight * 0.32,
        targetSide: 0,
        targetLift: -halfHeight * 0.30,
        targetDepth: 0.025,
        duration: 2,
        fov: 21,
        beat: "unlock",
        motionCue: { stage: "lock-release", open: 0.16 },
        focus: "锁扣释放、底部咬合点、金属条嵌入关系",
        script: "压到局部特写，锁扣释放和底部咬合点必须看清。"
      }),
      shot({
        at: 39,
        label: "15 上滑开启跟拍",
        depth: detail * 1.08,
        side: halfWidth * 0.12,
        lift: -halfHeight * 0.02,
        targetSide: halfWidth * 0.04,
        targetLift: -halfHeight * 0.01,
        targetDepth: 0.028,
        duration: 3,
        fov: 24,
        beat: "track opening",
        motionCue: { stage: "opening", open: 0.55 },
        focus: "拉杆上移、纱网收纳、两侧导轨顺滑",
        script: "镜头跟着拉杆上滑，让纱网、导轨和拉杆形成清楚的运动关系。"
      }),
      shot({
        at: 42,
        label: "16 全开上帝复核",
        depth: wide * 0.94,
        side: -halfWidth * 0.08,
        lift: halfHeight * 0.32,
        targetSide: 0,
        targetLift: halfHeight * 0.18,
        targetDepth: 0.034,
        duration: 2.2,
        fov: 28,
        beat: "open structure",
        motionCue: { stage: "open-hold", open: 1 },
        focus: "全开开口、顶部收纳、底部通道、整体结构",
        script: "从底部局部抬到上帝视角，复核顶部收纳、底部开口和整体结构关系。"
      }),
      shot({
        at: 43.2,
        label: "17 打开下口进入点",
        depth: detail * 0.62,
        side: -halfWidth * 0.04,
        lift: -halfHeight * 0.34,
        targetSide: 0,
        targetLift: -halfHeight * 0.30,
        targetDepth: 0.02,
        duration: 2,
        hold: 0.1,
        fov: 23,
        beat: "threshold prep",
        motionCue: { stage: "open-hold", open: 1 },
        focus: "打开后的底部通道、下沿轨道、穿行路径",
        script: "镜头落到打开后的下口，先看清通过路径：下沿、导轨、空隙都明确，下一步才从这里滑出去。"
      }),
      shot({
        at: 45.2,
        label: "18 从打开下口穿出",
        depth: -macro * 0.18,
        side: 0,
        lift: -halfHeight * 0.30,
        targetSide: 0,
        targetLift: -halfHeight * 0.20,
        targetDepth: 0.012,
        duration: 1.8,
        hold: 0.06,
        fov: 22,
        beat: "pass through opening",
        motionCue: { stage: "open-hold", open: 1 },
        focus: "镜头从已打开下口穿过、不过墙",
        script: "相机沿打开后的下口平滑滑出，路径贴着窗洞中心走，强调是通过开口，而不是穿墙。"
      }),
      shot({
        at: 47,
        label: "19 窗外反看纱窗",
        depth: -detail * 0.72,
        side: halfWidth * 0.12,
        lift: halfHeight * 0.06,
        targetSide: halfWidth * 0.03,
        targetLift: halfHeight * 0.02,
        targetDepth: 0.018,
        duration: 1.6,
        fov: 26,
        beat: "outside reverse",
        motionCue: { stage: "open-hold", open: 1 },
        focus: "窗外视角、外侧边框、纱网收纳后开口",
        script: "来到窗外反看产品，确认外侧边框、收纳位置和窗洞关系，补足跨境电商需要的外观全貌。"
      }),
      shot({
        at: 48.6,
        label: "20 窗外俯视结构",
        depth: -mid * 0.62,
        side: -halfWidth * 0.16,
        lift: halfHeight * 0.60,
        targetSide: -halfWidth * 0.04,
        targetLift: halfHeight * 0.16,
        targetDepth: 0.014,
        duration: 1.4,
        hold: 0.08,
        fov: 28,
        beat: "outside high angle",
        motionCue: { stage: "open-hold", open: 1 },
        focus: "俯视开口、顶部盒体、外侧安装厚度",
        script: "窗外高角度俯视，补一眼顶部盒体、安装厚度和开口尺度，让产品不只是正面好看。"
      }),
      shot({
        at: 50,
        label: "21 回到室内开始闭合",
        depth: detail * 0.74,
        side: halfWidth * 0.08,
        lift: -halfHeight * 0.18,
        targetSide: halfWidth * 0.03,
        targetLift: -halfHeight * 0.18,
        targetDepth: 0.026,
        duration: 1.8,
        fov: 23,
        beat: "return and close",
        motionCue: { stage: "closing", open: 0.62 },
        focus: "从开口回室内、拉杆向下回位",
        script: "镜头沿同一个开口回到室内，同时纱网开始关闭，形成完整的内外切换闭环。"
      }),
      shot({
        at: 51.8,
        label: "22 拉杆回到底部",
        depth: detail * 0.98,
        side: halfWidth * 0.12,
        lift: -halfHeight * 0.32,
        targetSide: 0,
        targetLift: -halfHeight * 0.36,
        targetDepth: 0.024,
        duration: 0.6,
        fov: 22,
        beat: "bottom return",
        motionCue: { stage: "closing", open: 0.08 },
        focus: "拉杆回到底部、闭合前最后对齐",
        script: "拉杆回到底部，镜头贴近但不晃，强调回位过程的顺滑和对齐感。"
      }),
      shot({
        at: 52.4,
        label: "23 锁止闭合",
        depth: macro * 1.03,
        side: halfWidth * 0.04,
        lift: -halfHeight * 0.42,
        targetSide: 0,
        targetLift: -halfHeight * 0.38,
        targetDepth: 0.022,
        duration: 1.8,
        hold: 0.14,
        fov: 20,
        beat: "latch close",
        motionCue: { stage: "closed", open: 0 },
        focus: "锁扣咬合、底部密封、闭合反馈",
        script: "闭合完成后停在锁止点，让观众看到密封、齐平和最后的机械反馈。"
      }),
      shot({
        at: 54.2,
        label: "24 侧边密封扫查",
        depth: detail * 0.96,
        side: -halfWidth * 0.28,
        lift: -halfHeight * 0.06,
        targetSide: -halfWidth * 0.22,
        targetLift: -halfHeight * 0.04,
        targetDepth: 0.026,
        duration: 2,
        fov: 23,
        beat: "seal proof",
        focus: "闭合后的缝隙、侧边密封、金属条嵌入",
        script: "闭合后扫一遍侧边和缝隙，证明窗网嵌在金属条内，边界干净，不是浮在表面。"
      }),
      shot({
        at: 56.2,
        label: "25 产品英雄回看",
        depth: wide * 1.08,
        side: halfWidth * 0.08,
        lift: halfHeight * 0.08,
        targetSide: 0,
        targetLift: halfHeight * 0.04,
        targetDepth: 0.04,
        duration: 1.8,
        hold: 0.08,
        fov: 31,
        beat: "hero pullback",
        focus: "完整窗户、结构层级、室内采光",
        script: "镜头后撤回到完整产品，内外视角、开合动作和结构细节都讲完，最后回到居家交付画面。"
      }),
      shot({
        at: 58,
        label: "26 阳光与舒适感",
        depth: wide * 1.22,
        side: -halfWidth * 0.04,
        lift: halfHeight * 0.18,
        targetSide: 0,
        targetLift: halfHeight * 0.10,
        targetDepth: 0.045,
        duration: 1.2,
        fov: 34,
        beat: "warm finish",
        focus: "阳光、玻璃、室内舒适感",
        script: "轻轻抬视线，不脱离窗户，让阳光和舒适感成为最后的情绪。"
      }),
      shot({
        at: 60,
        label: "27 最终定格",
        depth: wide * 1.28,
        side: 0,
        lift: halfHeight * 0.12,
        targetSide: 0,
        targetLift: halfHeight * 0.04,
        targetDepth: 0.045,
        duration: 0.8,
        hold: 0.2,
        fov: 35,
        beat: "final lockoff",
        focus: "完整产品最终交付画面",
        script: "最终停稳，窗户完整、干净、可交付，画面不要再飘。"
      })
    );

    waypoints.splice(11, waypoints.length - 11,
      shot({
        at: 34,
        label: "12 开合前稳定预备",
        depth: mid * 0.98,
        side: halfWidth * 0.10,
        lift: -halfHeight * 0.22,
        targetSide: 0,
        targetLift: -halfHeight * 0.22,
        targetDepth: 0.03,
        duration: 1,
        hold: 0.1,
        fov: 25,
        beat: "settle before motion",
        focus: "待操作状态、底部拉杆、窗面整体",
        script: "动作开始前先稳一下，让观众知道马上要进入开合流程，画面中心锁定拉杆和纱网下沿。"
      }),
      shot({
        at: 35,
        label: "13 底部仰视准备",
        depth: mid * 1.02,
        side: halfWidth * 0.10,
        lift: -halfHeight * 0.66,
        targetSide: 0,
        targetLift: -halfHeight * 0.34,
        targetDepth: 0.032,
        duration: 2,
        fov: 25,
        beat: "bottom low angle",
        motionCue: { stage: "closed-to-release", open: 0 },
        focus: "底部滑轨、下沿密封、拉杆起点",
        script: "先从底部仰视进入，把下沿滑轨、密封条和拉杆起点交代清楚；这是从全局开合叙事落到机构细节的第一步。"
      }),
      shot({
        at: 37,
        label: "14 底部局部特写",
        depth: detail * 0.92,
        side: halfWidth * 0.12,
        lift: -halfHeight * 0.36,
        targetSide: 0,
        targetLift: -halfHeight * 0.38,
        targetDepth: 0.025,
        duration: 1.6,
        fov: 20,
        beat: "bottom close-up",
        motionCue: { stage: "lock-release", open: 0.16 },
        focus: "锁扣释放、底部咬合点、金属条嵌入关系",
        script: "继续压到局部特写，锁扣释放和底部咬合点必须看清；纱网边缘要像嵌进金属条里，而不是浮在外面。"
      }),
      shot({
        at: 38.6,
        label: "15 上滑开启跟拍",
        depth: detail * 1.04,
        side: halfWidth * 0.18,
        lift: -halfHeight * 0.10,
        targetSide: halfWidth * 0.04,
        targetLift: -halfHeight * 0.04,
        targetDepth: 0.028,
        duration: 2.6,
        fov: 24,
        beat: "track opening",
        motionCue: { stage: "opening", open: 0.55 },
        focus: "拉杆上移、纱网收纳、两侧导轨顺滑",
        script: "镜头跟着拉杆上滑，先保持局部，再逐渐带出两侧导轨；运动速度要柔顺，像稳定器贴着产品呼吸。"
      }),
      shot({
        at: 41.2,
        label: "16 全开上帝复核",
        depth: mid * 1.00,
        side: -halfWidth * 0.14,
        lift: halfHeight * 0.58,
        targetSide: -halfWidth * 0.02,
        targetLift: halfHeight * 0.12,
        targetDepth: 0.034,
        duration: 2,
        fov: 29,
        beat: "god view open check",
        motionCue: { stage: "open-hold", open: 1 },
        focus: "全开开口、顶部收纳、底部通道、整体结构",
        script: "从底部局部抬到上帝视角，复核顶部收纳、底部开口和整扇窗的结构关系；这是局部到全局的第一次完整转换。"
      }),
      shot({
        at: 43.2,
        label: "17 打开下口进入点",
        depth: detail * 0.62,
        side: -halfWidth * 0.04,
        lift: -halfHeight * 0.34,
        targetSide: 0,
        targetLift: -halfHeight * 0.30,
        targetDepth: 0.02,
        duration: 2,
        hold: 0.1,
        fov: 23,
        beat: "threshold prep",
        motionCue: { stage: "open-hold", open: 1 },
        focus: "打开后的底部通道、下沿轨道、穿行路径",
        script: "镜头落到打开后的下口，先看清通过路径：下沿、导轨、空隙都明确，下一步才从这里滑出去。"
      }),
      shot({
        at: 45.2,
        label: "18 从打开下口穿出",
        depth: -macro * 0.18,
        side: 0,
        lift: -halfHeight * 0.30,
        targetSide: 0,
        targetLift: -halfHeight * 0.20,
        targetDepth: 0.012,
        duration: 1.8,
        hold: 0.06,
        fov: 22,
        beat: "pass through opening",
        motionCue: { stage: "open-hold", open: 1 },
        focus: "镜头从已打开下口穿过、不过墙",
        script: "相机沿打开后的下口平滑滑出，路径贴着窗洞中心走，强调是通过开口，而不是穿墙。"
      }),
      shot({
        at: 47,
        label: "19 窗外反看纱窗",
        depth: -detail * 0.72,
        side: halfWidth * 0.12,
        lift: halfHeight * 0.06,
        targetSide: halfWidth * 0.03,
        targetLift: halfHeight * 0.02,
        targetDepth: 0.018,
        duration: 1.6,
        fov: 26,
        beat: "outside reverse",
        motionCue: { stage: "open-hold", open: 1 },
        focus: "窗外视角、外侧边框、纱网收纳后开口",
        script: "来到窗外反看产品，确认外侧边框、收纳位置和窗洞关系，补足跨境电商需要的外观全貌。"
      }),
      shot({
        at: 48.6,
        label: "20 窗外俯视结构",
        depth: -mid * 0.62,
        side: -halfWidth * 0.16,
        lift: halfHeight * 0.60,
        targetSide: -halfWidth * 0.04,
        targetLift: halfHeight * 0.16,
        targetDepth: 0.014,
        duration: 1.4,
        hold: 0.08,
        fov: 28,
        beat: "outside high angle",
        motionCue: { stage: "open-hold", open: 1 },
        focus: "俯视开口、顶部盒体、外侧安装厚度",
        script: "窗外高角度俯视，补一眼顶部盒体、安装厚度和开口尺度，让产品不只是正面好看。"
      }),
      shot({
        at: 50,
        label: "21 室内上帝视角闭合",
        depth: mid * 0.86,
        side: halfWidth * 0.06,
        lift: halfHeight * 0.50,
        targetSide: halfWidth * 0.02,
        targetLift: halfHeight * 0.02,
        targetDepth: 0.026,
        duration: 1.8,
        fov: 28,
        beat: "interior god close",
        motionCue: { stage: "closing", open: 0.62 },
        focus: "室内回看、顶部到底部的闭合路径、整体比例",
        script: "从窗外回到室内后先给一个上帝视角，让观众看到纱网从上往下回到轨道，整体动作路径一眼明白。"
      }),
      shot({
        at: 51.8,
        label: "22 底部局部闭合证明",
        depth: detail * 0.90,
        side: halfWidth * 0.12,
        lift: -halfHeight * 0.40,
        targetSide: 0,
        targetLift: -halfHeight * 0.40,
        targetDepth: 0.024,
        duration: 0.6,
        fov: 20,
        beat: "bottom proof close-up",
        motionCue: { stage: "closing", open: 0.08 },
        focus: "拉杆回到底部、底部密封齐平、锁扣前最后对齐",
        script: "从上帝视角迅速但丝滑地落回底部局部特写，证明回位、密封和对齐都准确，不让观众猜。"
      }),
      shot({
        at: 52.4,
        label: "23 锁止闭合",
        depth: macro * 1.03,
        side: halfWidth * 0.04,
        lift: -halfHeight * 0.42,
        targetSide: 0,
        targetLift: -halfHeight * 0.38,
        targetDepth: 0.022,
        duration: 1.8,
        hold: 0.14,
        fov: 20,
        beat: "latch close",
        motionCue: { stage: "closed", open: 0 },
        focus: "锁扣咬合、底部密封、闭合反馈",
        script: "闭合完成后停在锁止点，让观众看到密封、齐平和最后的机械反馈。"
      }),
      shot({
        at: 54.2,
        label: "24 侧边密封扫查",
        depth: detail * 0.96,
        side: -halfWidth * 0.28,
        lift: -halfHeight * 0.06,
        targetSide: -halfWidth * 0.22,
        targetLift: -halfHeight * 0.04,
        targetDepth: 0.026,
        duration: 2,
        fov: 23,
        beat: "seal proof",
        focus: "闭合后的缝隙、侧边密封、金属条嵌入",
        script: "闭合后扫一遍侧边和缝隙，证明窗网嵌在金属条内，边界干净，不是浮在表面。"
      }),
      shot({
        at: 56.2,
        label: "25 产品英雄回看",
        depth: wide * 1.08,
        side: halfWidth * 0.08,
        lift: halfHeight * 0.08,
        targetSide: 0,
        targetLift: halfHeight * 0.04,
        targetDepth: 0.04,
        duration: 1.8,
        hold: 0.08,
        fov: 31,
        beat: "hero pullback",
        focus: "完整窗户、结构层级、室内采光",
        script: "镜头后撤回到完整产品，内外视角、开合动作和结构细节都讲完，最后回到居家交付画面。"
      }),
      shot({
        at: 58,
        label: "26 阳光与舒适感",
        depth: wide * 1.22,
        side: -halfWidth * 0.04,
        lift: halfHeight * 0.18,
        targetSide: 0,
        targetLift: halfHeight * 0.10,
        targetDepth: 0.045,
        duration: 1.2,
        fov: 34,
        beat: "warm finish",
        focus: "阳光、玻璃、室内舒适感",
        script: "轻轻抬视线，不脱离窗户，让阳光和舒适感成为最后的情绪。"
      }),
      shot({
        at: 60,
        label: "27 最终定格",
        depth: wide * 1.28,
        side: 0,
        lift: halfHeight * 0.12,
        targetSide: 0,
        targetLift: halfHeight * 0.04,
        targetDepth: 0.045,
        duration: 0.8,
        hold: 0.2,
        fov: 35,
        beat: "final lockoff",
        focus: "完整产品最终交付画面",
        script: "最终停稳，窗户完整、干净、可交付，画面不要再飘。"
      })
    );

    lastObjectTourDebug = {
      source: "chuangsha-product-bottom-pass-cinematic-detailed-script",
      productCount: products.length,
      selectedTag: item.tag,
      product: {
        tag: item.tag,
        box: boxSnapshot(item.box),
        center: item.center.toArray().map((n) => +n.toFixed(3)),
        size: item.size.toArray().map((n) => +n.toFixed(3)),
        inward: inward.toArray().map((n) => +n.toFixed(3)),
        lateral: lateral.toArray().map((n) => +n.toFixed(3))
      },
      storyboard: waypoints.map((wp) => ({
        label: wp.label,
        beat: wp.beat || null,
        focus: wp.focus || null,
        script: wp.script || null,
        duration: wp.duration,
        hold: wp.hold,
        fov: Number.isFinite(wp.fov) ? wp.fov : null
      })),
      waypoints: cloneTourWaypoints(waypoints)
    };
    return waypoints;
  }

  function buildChuangshaProductTourOneTakeLegacy(options = {}) {
    const products = collectChuangshaWindowProducts(options.tags || ["181930", "182101"]);
    if (!products.length) {
      lastObjectTourDebug = {
        source: "chuangsha-one-take-60s-empty",
        reason: "no-chuangsha-window-replacements",
        waypoints: []
      };
      return [];
    }

    const item = options.tag
      ? products.find((product) => product.tag === String(options.tag)) || products[0]
      : products[0];
    const sceneCenter = getSceneHorizontalCenter();
    const inward = new THREE.Vector3();
    const depthAxis = item.depthAxis === "z" ? "z" : "x";
    const depthSign = Math.sign(sceneCenter[depthAxis] - item.center[depthAxis]) || -1;
    inward[depthAxis] = depthSign;
    const lateral = new THREE.Vector3(-inward.z, 0, inward.x).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const halfWidth = Math.max(0.34, Math.min(0.62, item.size[item.widthAxis] * 0.5));
    const halfHeight = Math.max(0.82, item.size.y * 0.5);
    const face = item.center.clone();
    const macro = Math.max(0.34, Math.min(0.46, item.size.y * 0.18));
    const detail = Math.max(0.5, Math.min(0.66, item.size.y * 0.27));
    const mid = Math.max(0.78, Math.min(0.98, item.size.y * 0.4));
    const wide = Math.max(1.08, Math.min(1.3, item.size.y * 0.58));
    const totalSeconds = 60;
    const look = (side = 0, lift = 0, depth = 0.035) => face.clone()
      .addScaledVector(lateral, side)
      .addScaledVector(up, lift)
      .addScaledVector(inward, depth);
    const shot = ({
      at,
      label,
      depth,
      side = 0,
      lift = 0,
      targetSide = 0,
      targetLift = 0,
      targetDepth = 0.035,
      duration = 2,
      hold = 0.02,
      fov = null,
      focus = "",
      script = "",
      beat = "",
      motionCue = null
    }) => {
      const wp = makeChuangshaProductTourWaypoint(
        label,
        item,
        offsetForProduct(item, inward, lateral, up, depth, side, lift),
        look(targetSide, targetLift, targetDepth),
        duration,
        hold,
        fov
      );
      wp.time = at;
      wp.at = Math.max(0, Math.min(1, at / totalSeconds));
      if (focus) wp.focus = focus;
      if (script) wp.script = script;
      if (beat) wp.beat = beat;
      if (motionCue) wp.motionCue = motionCue;
      return wp;
    };

    const waypoints = [
      shot({
        at: 0,
        label: "01 室内远景定场",
        depth: wide * 1.32,
        side: -halfWidth * 0.18,
        lift: halfHeight * 0.14,
        targetLift: halfHeight * 0.04,
        targetDepth: 0.045,
        duration: 4,
        hold: 0.1,
        fov: 36,
        beat: "establishing shot",
        focus: "窗户在室内空间里的位置、比例、采光关系",
        script: "从室内远景开始，窗户是唯一主角。镜头稳定、平视、慢慢被窗户吸引，不看门，不扫无关墙面。"
      }),
      shot({
        at: 4,
        label: "02 主体完整入画",
        depth: wide * 1.16,
        side: 0,
        lift: halfHeight * 0.08,
        targetLift: halfHeight * 0.04,
        targetDepth: 0.04,
        duration: 4,
        hold: 0.08,
        fov: 34,
        beat: "full shot",
        focus: "整扇窗完整轮廓、上下左右边界",
        script: "保持一镜到底的稳定推进，把整扇窗摆成产品英雄主体，先让观众知道这扇窗的全貌。"
      }),
      shot({
        at: 8,
        label: "03 右侧轻环绕",
        depth: wide * 1.04,
        side: halfWidth * 0.22,
        lift: halfHeight * 0.10,
        targetSide: halfWidth * 0.06,
        targetLift: halfHeight * 0.04,
        targetDepth: 0.038,
        duration: 4,
        fov: 32,
        beat: "arc orbit",
        focus: "窗框厚度、内外框层级",
        script: "从正面轻轻绕到侧面，靠视差说明窗不是一张平面，而是有厚度、有层级的结构。"
      }),
      shot({
        at: 12,
        label: "04 顶部上帝视角",
        depth: depthFull * 0.82,
        side: halfWidth * 0.12,
        lift: halfHeight * 0.90,
        targetSide: halfWidth * 0.03,
        targetLift: halfHeight * 0.42,
        targetDepth: 0.032,
        duration: 4,
        hold: 0.2,
        fov: 27,
        beat: "god view",
        focus: "顶部金属盒、上沿收口、安装厚度",
        script: "先给顶部一个上帝视角，把顶盒、上框和墙洞关系全交代清楚，再把视觉落回结构本体。"
      }),
      shot({
        at: 16,
        label: "05 顶部局部特写",
        depth: depthMacro * 1.10,
        side: -halfWidth * 0.10,
        lift: halfHeight * 0.62,
        targetSide: -halfWidth * 0.04,
        targetLift: halfHeight * 0.46,
        targetDepth: 0.024,
        duration: 4,
        fov: 22,
        beat: "top close-up",
        focus: "金属表面、顶盒边线、精密收口",
        script: "从上帝视角自然落到顶部局部特写，继续确认边线是否干净、是否像嵌在金属条里。"
      }),
      shot({
        at: 18,
        label: "06 左导轨下扫",
        depth: detail * 0.98,
        side: -halfWidth * 0.44,
        lift: halfHeight * 0.18,
        targetSide: -halfWidth * 0.32,
        targetLift: halfHeight * 0.06,
        targetDepth: 0.026,
        duration: 3,
        fov: 24,
        beat: "track down",
        focus: "左侧导轨、嵌入关系、边缘完整性",
        script: "顺左导轨往下扫，强调纱网与金属条的嵌入关系，边缘要清楚，但不要加黑线。"
      }),
      shot({
        at: 21,
        label: "07 右导轨对称验证",
        depth: detail * 0.98,
        side: halfWidth * 0.44,
        lift: halfHeight * 0.12,
        targetSide: halfWidth * 0.32,
        targetLift: halfHeight * 0.02,
        targetDepth: 0.026,
        duration: 3,
        fov: 24,
        beat: "pan and track",
        focus: "右侧导轨、封边、对称性",
        script: "横向过渡到右侧，让两边结构都被看见，避免观众只理解一半。"
      }),
      shot({
        at: 24,
        label: "08 窗网层次近景",
        depth: macro * 1.08,
        side: -halfWidth * 0.05,
        lift: halfHeight * 0.08,
        targetSide: -halfWidth * 0.02,
        targetLift: halfHeight * 0.04,
        targetDepth: 0.022,
        duration: 3,
        hold: 0.08,
        fov: 21,
        beat: "mesh close-up",
        focus: "纱网孔格、透光、玻璃反射",
        script: "靠近纱网，不靠突兀变焦，而是物理推近。观众能看见网格、透光和后方空间。"
      }),
      shot({
        at: 27,
        label: "09 下沿与把手预告",
        depth: detail * 1.02,
        side: -halfWidth * 0.10,
        lift: -halfHeight * 0.28,
        targetSide: -halfWidth * 0.02,
        targetLift: -halfHeight * 0.30,
        targetDepth: 0.026,
        duration: 3,
        fov: 24,
        beat: "tilt down",
        focus: "下沿、拉杆、手感位置",
        script: "镜头向下落到操作区域，为即将出现的开合动作做视觉铺垫。"
      }),
      shot({
        at: 30,
        label: "10 把手锁扣特写",
        depth: macro * 1.02,
        side: -halfWidth * 0.02,
        lift: -halfHeight * 0.40,
        targetSide: 0,
        targetLift: -halfHeight * 0.38,
        targetDepth: 0.022,
        duration: 2,
        hold: 0.12,
        fov: 20,
        beat: "close-up",
        focus: "拉杆、锁扣、底部咬合点",
        script: "用短暂停驻让观众明白这里是操作区，后面的动作会从这里开始。"
      }),
      shot({
        at: 32,
        label: "11 操作视角后撤",
        depth: detail * 1.18,
        side: halfWidth * 0.04,
        lift: -halfHeight * 0.30,
        targetSide: 0,
        targetLift: -halfHeight * 0.31,
        targetDepth: 0.028,
        duration: 2,
        fov: 23,
        beat: "pov prep",
        focus: "把手与整扇窗的空间关系",
        script: "从微距稍微后撤，切成类似使用者视角，但仍然是连续单镜头。"
      }),
      shot({
        at: 34,
        label: "12 开合前稳定",
        depth: mid * 0.98,
        side: halfWidth * 0.10,
        lift: -halfHeight * 0.22,
        targetSide: 0,
        targetLift: -halfHeight * 0.22,
        targetDepth: 0.03,
        duration: 2,
        hold: 0.12,
        fov: 25,
        beat: "settle before motion",
        focus: "待操作状态、底部拉杆、窗面整体",
        script: "动作开始前先稳一下，让用户知道马上要演示开合流程。"
      }),
      shot({
        at: 36,
        label: "13 开合演示开始",
        depth: mid * 0.96,
        side: halfWidth * 0.12,
        lift: -halfHeight * 0.18,
        targetSide: 0,
        targetLift: -halfHeight * 0.20,
        targetDepth: 0.032,
        duration: 1.2,
        fov: 25,
        beat: "motion start",
        motionCue: { stage: "closed-to-release", open: 0 },
        focus: "锁扣释放前的闭合状态",
        script: "36秒开始进入动作演示，窗体仍闭合，镜头准备跟随拉杆运动。"
      }),
      shot({
        at: 37.2,
        label: "14 锁扣释放",
        depth: detail * 0.98,
        side: halfWidth * 0.12,
        lift: -halfHeight * 0.28,
        targetSide: 0,
        targetLift: -halfHeight * 0.34,
        targetDepth: 0.025,
        duration: 1.8,
        fov: 22,
        beat: "unlock",
        motionCue: { stage: "lock-release", open: 0.16 },
        focus: "锁扣释放、拉杆起势",
        script: "锁扣释放，动作要轻、慢、准，给机械反馈一点可见的停顿。"
      }),
      shot({
        at: 39,
        label: "15 上滑开启跟拍",
        depth: detail * 1.08,
        side: halfWidth * 0.18,
        lift: -halfHeight * 0.02,
        targetSide: halfWidth * 0.04,
        targetLift: -halfHeight * 0.02,
        targetDepth: 0.028,
        duration: 2,
        fov: 24,
        beat: "track opening",
        motionCue: { stage: "opening", open: 0.55 },
        focus: "拉杆上移、纱网收起、导轨顺滑",
        script: "镜头与拉杆平行跟拍，窗纱沿导轨打开，重点是流畅和不抖。"
      }),
      shot({
        at: 41,
        label: "16 开启中段结构",
        depth: mid * 0.96,
        side: -halfWidth * 0.14,
        lift: halfHeight * 0.12,
        targetSide: 0,
        targetLift: halfHeight * 0.08,
        targetDepth: 0.034,
        duration: 2,
        fov: 27,
        beat: "opening structure",
        motionCue: { stage: "opening", open: 0.86 },
        focus: "纱网折叠/收纳后的通透度",
        script: "镜头略微抬高，让观众看到打开后窗面更通透，同时结构还在画面中心。"
      }),
      shot({
        at: 43,
        label: "17 全开停留",
        depth: wide * 0.96,
        side: 0,
        lift: halfHeight * 0.10,
        targetSide: 0,
        targetLift: halfHeight * 0.04,
        targetDepth: 0.04,
        duration: 1.8,
        hold: 0.16,
        fov: 30,
        beat: "open hold",
        motionCue: { stage: "open-hold", open: 1 },
        focus: "完全打开后的窗体全貌",
        script: "完全打开后停一拍，证明开口、导轨、收纳位置都合理。"
      }),
      shot({
        at: 44.8,
        label: "18 关闭回位",
        depth: detail * 1.04,
        side: halfWidth * 0.16,
        lift: -halfHeight * 0.06,
        targetSide: halfWidth * 0.04,
        targetLift: -halfHeight * 0.12,
        targetDepth: 0.028,
        duration: 1.2,
        fov: 23,
        beat: "reverse track",
        motionCue: { stage: "closing", open: 0.42 },
        focus: "回位过程、拉杆重新对齐底部",
        script: "反向跟拍关闭，动作不能突然加速，要像阻尼很好一样自然回位。"
      }),
      shot({
        at: 46,
        label: "19 锁止闭合",
        depth: macro * 1.04,
        side: halfWidth * 0.04,
        lift: -halfHeight * 0.42,
        targetSide: 0,
        targetLift: -halfHeight * 0.38,
        targetDepth: 0.022,
        duration: 3,
        hold: 0.14,
        fov: 20,
        beat: "latch close",
        motionCue: { stage: "closed", open: 0 },
        focus: "锁扣咬合、底部密封、闭合反馈",
        script: "46秒闭合完成，镜头停在锁止点，让观众看到闭合后的密封和齐平。"
      }),
      shot({
        at: 49,
        label: "20 密封缝隙确认",
        depth: detail * 0.96,
        side: -halfWidth * 0.28,
        lift: -halfHeight * 0.08,
        targetSide: -halfWidth * 0.22,
        targetLift: -halfHeight * 0.06,
        targetDepth: 0.026,
        duration: 2,
        fov: 23,
        beat: "seal proof",
        focus: "闭合后的缝隙、侧边密封、金属条嵌入",
        script: "闭合后不急着走，扫一遍缝隙和侧边，证明产品不是只会动，而是关得严。"
      }),
      shot({
        at: 51,
        label: "21 俯视结构复核",
        depth: mid * 0.92,
        side: halfWidth * 0.08,
        lift: halfHeight * 0.76,
        targetSide: 0,
        targetLift: halfHeight * 0.28,
        targetDepth: 0.033,
        duration: 2,
        fov: 27,
        beat: "high angle",
        focus: "上中下结构层级、安装厚度",
        script: "抬到高角度复核整体结构，给开合后的安装完整度一个总结镜头。"
      }),
      shot({
        at: 53,
        label: "22 纱网嵌入证明",
        depth: macro * 1.00,
        side: -halfWidth * 0.30,
        lift: halfHeight * 0.04,
        targetSide: -halfWidth * 0.22,
        targetLift: halfHeight * 0.02,
        targetDepth: 0.022,
        duration: 2,
        fov: 20,
        beat: "macro proof",
        focus: "纱网嵌在金属条内、不是浮贴",
        script: "最后再给一个近景证据，窗网嵌在金属条里面，结构边界清楚可见。"
      }),
      shot({
        at: 55,
        label: "23 导轨深度回看",
        depth: detail * 1.00,
        side: halfWidth * 0.42,
        lift: -halfHeight * 0.02,
        targetSide: halfWidth * 0.30,
        targetLift: -halfHeight * 0.03,
        targetDepth: 0.028,
        duration: 1.8,
        fov: 24,
        beat: "rail depth",
        focus: "侧向导轨深度、边缘对比、封边完整性",
        script: "从另一侧扫回，补齐导轨深度和封边细节。"
      }),
      shot({
        at: 56.8,
        label: "24 产品英雄回看",
        depth: wide * 1.08,
        side: halfWidth * 0.08,
        lift: halfHeight * 0.08,
        targetSide: 0,
        targetLift: halfHeight * 0.04,
        targetDepth: 0.04,
        duration: 1.2,
        hold: 0.08,
        fov: 31,
        beat: "hero pullback",
        focus: "完整窗户、结构层级、室内采光",
        script: "镜头后撤回到完整产品，开合和结构信息都已经讲完，现在回到高级居家氛围。"
      }),
      shot({
        at: 58,
        label: "25 阳光与舒适感",
        depth: wide * 1.22,
        side: -halfWidth * 0.04,
        lift: halfHeight * 0.18,
        targetSide: 0,
        targetLift: halfHeight * 0.10,
        targetDepth: 0.045,
        duration: 1.2,
        fov: 34,
        beat: "warm finish",
        focus: "阳光、玻璃、室内舒适感",
        script: "轻轻抬视线，不脱离窗户，让阳光和舒适感成为最后的情绪。"
      }),
      shot({
        at: 60,
        label: "26 最终定格",
        depth: wide * 1.28,
        side: 0,
        lift: halfHeight * 0.12,
        targetSide: 0,
        targetLift: halfHeight * 0.04,
        targetDepth: 0.045,
        duration: 0.8,
        hold: 0.2,
        fov: 35,
        beat: "final lockoff",
        focus: "完整产品最终交付画面",
        script: "最终停稳，窗户完整、干净、可交付，画面不要再飘。"
      })
    ];

    waypoints.splice(11, waypoints.length - 11,
      shot({
        at: 34,
        label: "12 开合前稳定预备",
        depth: mid * 0.98,
        side: halfWidth * 0.10,
        lift: -halfHeight * 0.22,
        targetSide: 0,
        targetLift: -halfHeight * 0.22,
        targetDepth: 0.03,
        duration: 1,
        hold: 0.1,
        fov: 25,
        beat: "settle before motion",
        focus: "待操作状态、底部拉杆、窗面整体",
        script: "动作开始前先稳一下，让观众知道马上要进入开合流程，画面中心锁定拉杆和纱网下沿。"
      }),
      shot({
        at: 35,
        label: "13 锁扣释放前近景",
        depth: mid * 0.96,
        side: halfWidth * 0.12,
        lift: -halfHeight * 0.18,
        targetSide: 0,
        targetLift: -halfHeight * 0.20,
        targetDepth: 0.032,
        duration: 1.2,
        fov: 25,
        beat: "motion start",
        motionCue: { stage: "closed-to-release", open: 0 },
        focus: "闭合状态、锁扣咬合、拉杆起点",
        script: "先给闭合状态一个清楚交代：锁扣、底部密封和拉杆起点都在画面内，动作从这里发生。"
      }),
      shot({
        at: 36.2,
        label: "14 锁扣释放停顿",
        depth: detail * 0.98,
        side: halfWidth * 0.12,
        lift: -halfHeight * 0.28,
        targetSide: 0,
        targetLift: -halfHeight * 0.34,
        targetDepth: 0.025,
        duration: 2.4,
        fov: 22,
        beat: "unlock",
        motionCue: { stage: "lock-release", open: 0.16 },
        focus: "锁扣释放、拉杆轻微抬起、机械反馈",
        script: "锁扣释放时不要急推，给观众一个能感受到机构反应的停顿，像产品广告里的微距操作镜头。"
      }),
      shot({
        at: 38.6,
        label: "15 上滑开启跟拍",
        depth: detail * 1.08,
        side: halfWidth * 0.18,
        lift: -halfHeight * 0.06,
        targetSide: halfWidth * 0.04,
        targetLift: -halfHeight * 0.02,
        targetDepth: 0.028,
        duration: 2.6,
        fov: 24,
        beat: "track opening",
        motionCue: { stage: "opening", open: 0.55 },
        focus: "拉杆上移、纱网收纳、两侧导轨顺滑",
        script: "镜头与拉杆平行上移，速度比机构略慢半拍，让纱网收起、导轨和拉杆形成清楚的运动关系。"
      }),
      shot({
        at: 41.2,
        label: "16 全开结构确认",
        depth: mid * 0.94,
        side: -halfWidth * 0.10,
        lift: halfHeight * 0.16,
        targetSide: 0,
        targetLift: halfHeight * 0.10,
        targetDepth: 0.034,
        duration: 2,
        fov: 27,
        beat: "open structure",
        motionCue: { stage: "open-hold", open: 1 },
        focus: "全开开口、收纳位置、窗面通透度",
        script: "纱窗完全打开后镜头抬高一点，确认开口已经形成，观众能理解后面镜头会从这个开口经过。"
      }),
      shot({
        at: 43.2,
        label: "17 打开下口进入点",
        depth: detail * 0.62,
        side: -halfWidth * 0.04,
        lift: -halfHeight * 0.34,
        targetSide: 0,
        targetLift: -halfHeight * 0.30,
        targetDepth: 0.02,
        duration: 2,
        hold: 0.1,
        fov: 23,
        beat: "threshold prep",
        motionCue: { stage: "open-hold", open: 1 },
        focus: "打开后的底部通道、下沿轨道、穿行路径",
        script: "镜头落到打开后的下口，先看清通过路径：下沿、导轨、空隙都明确，下一步才从这里滑出去。"
      }),
      shot({
        at: 45.2,
        label: "18 从打开下口穿出",
        depth: -macro * 0.18,
        side: 0,
        lift: -halfHeight * 0.30,
        targetSide: 0,
        targetLift: -halfHeight * 0.20,
        targetDepth: 0.012,
        duration: 1.8,
        hold: 0.06,
        fov: 22,
        beat: "pass through opening",
        motionCue: { stage: "open-hold", open: 1 },
        focus: "镜头从已打开下口穿过、不过墙",
        script: "相机沿打开后的下口平滑滑出，路径贴着窗洞中心走，强调是通过开口，而不是穿墙。"
      }),
      shot({
        at: 47,
        label: "19 窗外反看纱窗",
        depth: -detail * 0.72,
        side: halfWidth * 0.12,
        lift: halfHeight * 0.06,
        targetSide: halfWidth * 0.03,
        targetLift: halfHeight * 0.02,
        targetDepth: 0.018,
        duration: 1.6,
        fov: 26,
        beat: "outside reverse",
        motionCue: { stage: "open-hold", open: 1 },
        focus: "窗外视角、外侧边框、纱网收纳后开口",
        script: "来到窗外反看产品，确认外侧边框、收纳位置和窗洞关系，补足跨境电商需要的外观全貌。"
      }),
      shot({
        at: 48.6,
        label: "20 窗外俯视结构",
        depth: -mid * 0.62,
        side: -halfWidth * 0.16,
        lift: halfHeight * 0.60,
        targetSide: -halfWidth * 0.04,
        targetLift: halfHeight * 0.16,
        targetDepth: 0.014,
        duration: 1.4,
        hold: 0.08,
        fov: 28,
        beat: "outside high angle",
        motionCue: { stage: "open-hold", open: 1 },
        focus: "俯视开口、顶部盒体、外侧安装厚度",
        script: "窗外高角度俯视，补一眼顶部盒体、安装厚度和开口尺度，让产品不只是正面好看。"
      }),
      shot({
        at: 50,
        label: "21 回到室内开始闭合",
        depth: detail * 0.74,
        side: halfWidth * 0.08,
        lift: -halfHeight * 0.18,
        targetSide: halfWidth * 0.03,
        targetLift: -halfHeight * 0.18,
        targetDepth: 0.026,
        duration: 1.8,
        fov: 23,
        beat: "return and close",
        motionCue: { stage: "closing", open: 0.62 },
        focus: "从开口回室内、拉杆向下回位",
        script: "镜头沿同一个开口回到室内，同时纱网开始关闭，形成完整的内外切换闭环。"
      }),
      shot({
        at: 51.8,
        label: "22 拉杆回到底部",
        depth: detail * 0.98,
        side: halfWidth * 0.12,
        lift: -halfHeight * 0.32,
        targetSide: 0,
        targetLift: -halfHeight * 0.36,
        targetDepth: 0.024,
        duration: 0.6,
        fov: 22,
        beat: "bottom return",
        motionCue: { stage: "closing", open: 0.08 },
        focus: "拉杆回到底部、闭合前最后对齐",
        script: "拉杆回到底部，镜头贴近但不晃，强调回位过程的顺滑和对齐感。"
      }),
      shot({
        at: 52.4,
        label: "23 锁止闭合",
        depth: macro * 1.03,
        side: halfWidth * 0.04,
        lift: -halfHeight * 0.42,
        targetSide: 0,
        targetLift: -halfHeight * 0.38,
        targetDepth: 0.022,
        duration: 1.8,
        hold: 0.14,
        fov: 20,
        beat: "latch close",
        motionCue: { stage: "closed", open: 0 },
        focus: "锁扣咬合、底部密封、闭合反馈",
        script: "闭合完成后停在锁止点，让观众看到密封、齐平和最后的机械反馈。"
      }),
      shot({
        at: 54.2,
        label: "24 侧边密封扫查",
        depth: detail * 0.96,
        side: -halfWidth * 0.28,
        lift: -halfHeight * 0.06,
        targetSide: -halfWidth * 0.22,
        targetLift: -halfHeight * 0.04,
        targetDepth: 0.026,
        duration: 2,
        fov: 23,
        beat: "seal proof",
        focus: "闭合后的缝隙、侧边密封、金属条嵌入",
        script: "闭合后扫一遍侧边和缝隙，证明窗网嵌在金属条内，边界干净，不是浮在表面。"
      }),
      shot({
        at: 56.2,
        label: "25 产品英雄回看",
        depth: wide * 1.08,
        side: halfWidth * 0.08,
        lift: halfHeight * 0.08,
        targetSide: 0,
        targetLift: halfHeight * 0.04,
        targetDepth: 0.04,
        duration: 1.8,
        hold: 0.08,
        fov: 31,
        beat: "hero pullback",
        focus: "完整窗户、结构层级、室内采光",
        script: "镜头后撤回到完整产品，内外视角、开合动作和结构细节都讲完，最后回到居家交付画面。"
      }),
      shot({
        at: 58,
        label: "26 阳光与舒适感",
        depth: wide * 1.22,
        side: -halfWidth * 0.04,
        lift: halfHeight * 0.18,
        targetSide: 0,
        targetLift: halfHeight * 0.10,
        targetDepth: 0.045,
        duration: 1.2,
        fov: 34,
        beat: "warm finish",
        focus: "阳光、玻璃、室内舒适感",
        script: "轻轻抬视线，不脱离窗户，让阳光和舒适感成为最后的情绪。"
      }),
      shot({
        at: 60,
        label: "27 最终定格",
        depth: wide * 1.28,
        side: 0,
        lift: halfHeight * 0.12,
        targetSide: 0,
        targetLift: halfHeight * 0.04,
        targetDepth: 0.045,
        duration: 0.8,
        hold: 0.2,
        fov: 35,
        beat: "final lockoff",
        focus: "完整产品最终交付画面",
        script: "最终停稳，窗户完整、干净、可交付，画面不要再飘。"
      })
    );

    lastObjectTourDebug = {
      source: "chuangsha-window-one-take-60s-motion-script",
      productCount: products.length,
      selectedTag: item.tag,
      motionPlan: {
        duration: totalSeconds,
        actionWindow: [35, 52.4],
        mechanism: "vertical-retractable-screen",
        stages: [
          "35.0s closed-to-release",
          "36.2s lock-release",
          "38.6s opening-track",
          "41.2s open-hold",
          "45.2s pass-through-open-bottom",
          "47.0s outside-reverse",
          "48.6s outside-high-angle",
          "50.0s closing-return",
          "52.4s latch-close"
        ]
      },
      product: {
        tag: item.tag,
        box: boxSnapshot(item.box),
        center: item.center.toArray().map((n) => +n.toFixed(3)),
        size: item.size.toArray().map((n) => +n.toFixed(3)),
        inward: inward.toArray().map((n) => +n.toFixed(3)),
        lateral: lateral.toArray().map((n) => +n.toFixed(3))
      },
      storyboard: waypoints.map((wp) => ({
        time: Number.isFinite(wp.time) ? wp.time : null,
        at: Number.isFinite(wp.at) ? +wp.at.toFixed(4) : null,
        label: wp.label,
        beat: wp.beat || null,
        focus: wp.focus || null,
        script: wp.script || null,
        motionCue: wp.motionCue || null,
        duration: wp.duration,
        hold: wp.hold,
        fov: Number.isFinite(wp.fov) ? wp.fov : null
      })),
      waypoints: cloneTourWaypoints(waypoints)
    };
    return waypoints;
  }

  function buildChuangshaProductTourOneTake(options = {}) {
    const products = collectChuangshaWindowProducts(options.tags || ["181930", "182101"]);
    if (!products.length) {
      lastObjectTourDebug = {
        source: "one_take_window_product_60s-empty",
        reason: "no-chuangsha-window-replacements",
        waypoints: []
      };
      return [];
    }

    const item = options.tag
      ? products.find((product) => product.tag === String(options.tag)) || products[0]
      : products[0];
    const sceneCenter = getSceneHorizontalCenter();
    const inward = new THREE.Vector3();
    const depthAxis = item.depthAxis === "z" ? "z" : "x";
    const depthSign = Math.sign(sceneCenter[depthAxis] - item.center[depthAxis]) || -1;
    inward[depthAxis] = depthSign;
    const lateral = new THREE.Vector3(-inward.z, 0, inward.x).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const halfWidth = Math.max(0.34, Math.min(0.72, item.size[item.widthAxis] * 0.5));
    const halfHeight = Math.max(0.82, item.size.y * 0.5);
    const face = item.center.clone();
    const totalSeconds = 60;
    const depthLong = Math.max(1.02, Math.min(1.25, item.size.y * 0.56));
    const depthFull = Math.max(0.86, Math.min(1.08, item.size.y * 0.48));
    const depthMedium = Math.max(0.64, Math.min(0.82, item.size.y * 0.37));
    const depthClose = Math.max(0.40, Math.min(0.56, item.size.y * 0.24));
    const depthMacro = Math.max(0.30, Math.min(0.40, item.size.y * 0.18));
    const look = (side = 0, lift = 0, depth = 0.032) => face.clone()
      .addScaledVector(lateral, side)
      .addScaledVector(up, lift)
      .addScaledVector(inward, depth);
    const addMeta = (wp, meta) => {
      Object.assign(wp, {
        time: meta.at,
        at: Math.max(0, Math.min(1, meta.at / totalSeconds)),
        range: meta.range,
        shotSize: meta.shotSize,
        cameraAngle: meta.cameraAngle,
        cameraMove: meta.cameraMove,
        subjectLock: "window",
        forbidden: ["door", "random wall", "exterior drift", "wall clipping"],
        tone: "premium, smooth, warm, product-focused",
        purpose: meta.purpose,
        focus: meta.focusKey,
        movement: meta.movement,
        framing: meta.framing,
        notes: meta.notes,
        beat: meta.beat,
        script: meta.notes
      });
      if (meta.motionCue) wp.motionCue = meta.motionCue;
      return wp;
    };
    const shot = (meta) => {
      const wp = makeChuangshaProductTourWaypoint(
        meta.label,
        item,
        offsetForProduct(item, inward, lateral, up, meta.depth, meta.side || 0, meta.lift || 0),
        look(meta.targetSide || 0, meta.targetLift || 0, meta.targetDepth ?? 0.032),
        meta.duration,
        meta.hold,
        meta.fov
      );
      return addMeta(wp, meta);
    };

    const waypoints = [
      shot({
        at: 0,
        range: "0-4s",
        label: "01 右肩定场",
        beat: "Long Shot · Right 3/4 · Steadicam + slow Dolly In",
        shotSize: "Long Shot",
        cameraAngle: "Right 3/4 Eye Level",
        cameraMove: "Steadicam + slow Dolly In",
        depth: depthLong * 1.02,
        side: halfWidth * 0.38,
        lift: halfHeight * 0.14,
        targetSide: halfWidth * 0.04,
        targetLift: halfHeight * 0.06,
        duration: 4,
        hold: 0.2,
        fov: 40,
        purpose: "intro",
        focusKey: "room",
        movement: "push",
        framing: "wide",
        notes: "从右肩 3/4 角度建立产品，不正中怼脸。室内只做前景层次，焦点牢牢锁住窗户。"
      }),
      shot({
        at: 4,
        range: "4-8s",
        label: "02 左肩反看轮廓",
        beat: "Full Shot · Left 3/4 · Arc Slide across face",
        shotSize: "Full Shot",
        cameraAngle: "Left 3/4 Eye Level",
        cameraMove: "Arc Slide across face",
        depth: depthFull * 0.96,
        side: -halfWidth * 0.34,
        lift: halfHeight * 0.08,
        targetSide: -halfWidth * 0.04,
        targetLift: halfHeight * 0.05,
        duration: 4,
        hold: 0.2,
        fov: 34,
        purpose: "whole",
        focusKey: "window",
        movement: "push",
        framing: "full",
        notes: "切到左肩反看完整轮廓，形成左右关系。不要停在正中，让窗框厚度和室内纵深同时出现。"
      }),
      shot({
        at: 8,
        range: "8-12s",
        label: "03 右侧厚度回旋",
        beat: "Full to Medium · Eye Level · controlled Arc Orbit right",
        shotSize: "Full to Medium",
        cameraAngle: "Eye Level",
        cameraMove: "small Arc Orbit right",
        depth: depthFull * 0.9,
        side: halfWidth * 0.42,
        lift: halfHeight * 0.12,
        targetSide: halfWidth * 0.10,
        targetLift: halfHeight * 0.06,
        duration: 4,
        hold: 0.1,
        fov: 31,
        purpose: "detail",
        focusKey: "frame",
        movement: "orbit",
        framing: "medium",
        notes: "从左肩滑回右侧，用一个受控小弧展示框体厚度、金属侧边和室内窗洞层次。"
      }),
      shot({
        at: 12,
        range: "12-16s",
        label: "04 顶部俯冲",
        beat: "God View · High Angle · Crane Up then Dive In",
        shotSize: "Medium",
        cameraAngle: "High Angle / God View",
        cameraMove: "Crane Up then Dive In",
        depth: depthFull * 0.82,
        side: -halfWidth * 0.18,
        lift: halfHeight * 0.72,
        targetSide: halfWidth * 0.02,
        targetLift: halfHeight * 0.48,
        duration: 4,
        hold: 0.3,
        fov: 27,
        purpose: "detail",
        focusKey: "frame",
        movement: "crane",
        framing: "medium",
        notes: "顶部先给上帝视角，再俯冲压向顶盒。看顶盒、上沿金属条和墙洞收口，形成第一次高处能量。"
      }),
      shot({
        at: 16,
        range: "16-20s",
        label: "05 顶部金属掠过",
        beat: "Close-up · High Side Angle · Glide along titanium rail",
        shotSize: "Close-up",
        cameraAngle: "High Side Angle",
        cameraMove: "Glide along titanium rail",
        depth: depthMacro * 1.08,
        side: halfWidth * 0.24,
        lift: halfHeight * 0.58,
        targetSide: halfWidth * 0.12,
        targetLift: halfHeight * 0.44,
        duration: 4,
        hold: 0.2,
        fov: 21,
        purpose: "detail",
        focusKey: "frame",
        movement: "push",
        framing: "macro",
        notes: "沿顶部钛金属条横向掠过，展示冷银反光、拉丝细节和顶盒边线。"
      }),
      shot({
        at: 20,
        range: "20-24s",
        label: "06 左导轨扫描",
        beat: "Medium Close · High Angle · Track Down left rail",
        shotSize: "Medium Close",
        cameraAngle: "High Angle",
        cameraMove: "Track Down left rail",
        depth: depthClose * 0.94,
        side: -halfWidth * 0.30,
        lift: halfHeight * 0.30,
        targetSide: -halfWidth * 0.30,
        targetLift: halfHeight * 0.08,
        duration: 4,
        hold: 0.15,
        fov: 23,
        purpose: "detail",
        focusKey: "track",
        movement: "track",
        framing: "close",
        notes: "真正给到左侧视角：从左上沿导轨下扫，确认纱网边缘嵌在金属条内。"
      }),
      shot({
        at: 24,
        range: "24-28s",
        label: "07 右导轨与纱网",
        beat: "Medium Close · Eye Level · Pan + Track right rail",
        shotSize: "Medium Close",
        cameraAngle: "Eye Level",
        cameraMove: "Pan + Track right rail",
        depth: depthClose * 0.94,
        side: halfWidth * 0.34,
        lift: halfHeight * 0.14,
        targetSide: halfWidth * 0.30,
        targetLift: halfHeight * 0.04,
        duration: 4,
        hold: 0.15,
        fov: 23,
        purpose: "detail",
        focusKey: "track",
        movement: "track",
        framing: "close",
        notes: "右侧反扫，和左侧形成对照。看右导轨、封边、纱网透光和钛金属反射。"
      }),
      shot({
        at: 28,
        range: "28-32s",
        label: "08 俯冲到底部屏幕",
        beat: "Medium · Downward Dive · Top-to-bottom Crane",
        shotSize: "Medium",
        cameraAngle: "High to Low Angle",
        cameraMove: "Top-to-bottom Crane Dive with Right Turn",
        depth: depthMedium * 1.02,
        side: halfWidth * 0.16,
        lift: -halfHeight * 0.58,
        targetSide: halfWidth * 0.08,
        targetLift: -halfHeight * 0.78,
        targetDepth: 0.032,
        duration: 4,
        hold: 0.2,
        fov: 24,
        purpose: "detail",
        focusKey: "display",
        movement: "crane",
        framing: "medium",
        notes: "从上方俯冲到底部控制区，明确看见黑色显示屏、下沿轨道、拉杆起点和屏幕所在位置。"
      }),
      shot({
        at: 32,
        range: "32-36s",
        label: "09 显示屏与按钮特写",
        beat: "Extreme Close-up · Low Angle · Bottom-up Push",
        shotSize: "Extreme Close-up",
        cameraAngle: "Low Angle",
        cameraMove: "Bottom-up Push from Right",
        depth: depthMacro * 0.82,
        side: halfWidth * 0.34,
        lift: -halfHeight * 0.78,
        targetSide: halfWidth * 0.03,
        targetLift: -halfHeight * 0.88,
        targetDepth: 0.024,
        duration: 4,
        hold: 0.3,
        fov: 16,
        purpose: "motion",
        focusKey: "button",
        movement: "push",
        framing: "macro",
        notes: "从底部往上冲到显示屏和按钮，黑色屏幕、金属按钮、底部密封必须完整入画，这是产品操作感核心卖点。"
      }),
      shot({
        at: 36,
        range: "36-39s",
        label: "10 按钮触发开启",
        beat: "Medium Close · Side Low Angle · Track with control bar",
        shotSize: "Medium Close",
        cameraAngle: "Side Low Angle",
        cameraMove: "Track with display and button",
        depth: depthClose * 0.88,
        side: halfWidth * 0.42,
        lift: -halfHeight * 0.68,
        targetSide: halfWidth * 0.08,
        targetLift: -halfHeight * 0.84,
        targetDepth: 0.028,
        duration: 3,
        hold: 0.1,
        fov: 20,
        purpose: "motion",
        focusKey: "button",
        movement: "track",
        framing: "medium",
        motionCue: { stage: "closed-to-release", open: 0 },
        notes: "从右下侧看按钮/显示屏触发开启，动作开始要慢、准，让观众看到控制区和纱网机构发生联动。"
      }),
      shot({
        at: 39,
        range: "39-43s",
        label: "11 上滑开启跟拍",
        beat: "Medium · Eye Level · parallel Track + Crane Up",
        shotSize: "Medium",
        cameraAngle: "Eye Level",
        cameraMove: "parallel Track + Crane Up",
        depth: depthMedium * 0.88,
        side: halfWidth * 0.24,
        lift: -halfHeight * 0.04,
        targetSide: halfWidth * 0.10,
        targetLift: halfHeight * 0.18,
        duration: 4,
        hold: 0.2,
        fov: 27,
        purpose: "motion",
        focusKey: "mesh",
        movement: "track",
        framing: "medium",
        motionCue: { stage: "opening", open: 0.62 },
        notes: "从左下侧跟拍上滑，形成底部上冲到中上部的连续运动，看清纱网收纳和导轨顺滑。"
      }),
      shot({
        at: 43,
        range: "43-46s",
        label: "12 关闭回位",
        beat: "Medium Close · High Angle slight · reverse Track + Dolly In",
        shotSize: "Medium Close",
        cameraAngle: "High Angle slight",
        cameraMove: "reverse Track + Dolly In",
        depth: depthClose * 0.96,
        side: halfWidth * 0.30,
        lift: halfHeight * 0.18,
        targetSide: halfWidth * 0.06,
        targetLift: -halfHeight * 0.14,
        duration: 3,
        hold: 0.3,
        fov: 23,
        purpose: "motion",
        focusKey: "track",
        movement: "track",
        framing: "close",
        motionCue: { stage: "closing", open: 0.38 },
        notes: "右上侧反向跟拍关闭，形成左右切换后的回位证明；最后看锁扣咬合回到底部。"
      }),
      shot({
        at: 46,
        range: "46-50s",
        label: "13 上帝到局部密封确认",
        beat: "God View to Close-up · Crane Down + Pan",
        shotSize: "Close-up",
        cameraAngle: "High Angle to Eye Level",
        cameraMove: "Crane Down + Pan",
        depth: depthClose * 0.94,
        side: -halfWidth * 0.18,
        lift: halfHeight * 0.58,
        targetSide: -halfWidth * 0.10,
        targetLift: -halfHeight * 0.06,
        duration: 4,
        hold: 0.25,
        fov: 22,
        purpose: "detail",
        focusKey: "frame",
        movement: "crane",
        framing: "close",
        motionCue: { stage: "closed", open: 0 },
        notes: "第二次高角度俯看，从左上方向下落到密封边，确认顶部到底部都回到同一平面。"
      }),
      shot({
        at: 50,
        range: "50-54s",
        label: "14 局部到全貌回看",
        beat: "Full Shot · Eye Level · Dolly Out",
        shotSize: "Full Shot",
        cameraAngle: "Eye Level",
        cameraMove: "Dolly Out",
        depth: depthMedium * 1.04,
        side: -halfWidth * 0.26,
        lift: halfHeight * 0.05,
        targetSide: -halfWidth * 0.04,
        targetLift: halfHeight * 0.04,
        duration: 4,
        hold: 0.3,
        fov: 31,
        purpose: "hero",
        focusKey: "window",
        movement: "pull",
        framing: "full",
        notes: "从左侧局部拉回完整产品，和开场右肩形成呼应，产品全貌不正中死板。"
      }),
      shot({
        at: 54,
        range: "54-58s",
        label: "15 居家氛围",
        beat: "Long Shot · Eye to slight Low Angle · Dolly Out + Tilt Up",
        shotSize: "Long Shot",
        cameraAngle: "Eye to slight Low Angle",
        cameraMove: "Dolly Out + Tilt Up",
        depth: depthLong * 1.00,
        side: halfWidth * 0.20,
        lift: halfHeight * 0.16,
        targetLift: halfHeight * 0.10,
        duration: 4,
        hold: 0.2,
        fov: 36,
        purpose: "whole",
        focusKey: "room",
        movement: "pull",
        framing: "wide",
        notes: "阳光、舒适室内。让窗户仍是画面中心，补一点温暖居家感，背景保持干净明亮。"
      }),
      shot({
        at: 60,
        range: "58-60s",
        label: "16 最终定格",
        beat: "Long Shot · Eye Level · ease to stop",
        shotSize: "Long Shot",
        cameraAngle: "Eye Level",
        cameraMove: "ease to stop",
        depth: depthLong * 1.04,
        side: halfWidth * 0.12,
        lift: halfHeight * 0.12,
        targetLift: halfHeight * 0.04,
        duration: 2,
        hold: 0.5,
        fov: 35,
        purpose: "hero",
        focusKey: "window",
        movement: "hold",
        framing: "wide",
        notes: "完整窗户交付画面。58-60 秒进入最终缓停，窗户完整、干净、可交付。"
      })
    ];

    lastObjectTourDebug = {
      source: "one_take_window_product_60s",
      mode: "continuous",
      duration: totalSeconds,
      cameraStyle: "steadicam + dolly + track + crane",
      subjectLock: "window",
      forbidden: ["door", "random wall", "exterior drift", "wall clipping"],
      tone: "premium, smooth, warm, product-focused",
      motionDemo: [36, 46],
      legacyBuilder: "buildChuangshaProductTourOneTakeLegacy",
      productCount: products.length,
      selectedTag: item.tag,
      product: {
        tag: item.tag,
        box: boxSnapshot(item.box),
        center: item.center.toArray().map((n) => +n.toFixed(3)),
        size: item.size.toArray().map((n) => +n.toFixed(3)),
        inward: inward.toArray().map((n) => +n.toFixed(3)),
        lateral: lateral.toArray().map((n) => +n.toFixed(3))
      },
      storyboard: waypoints.map((wp) => ({
        range: wp.range,
        time: Number.isFinite(wp.time) ? wp.time : null,
        at: Number.isFinite(wp.at) ? +wp.at.toFixed(4) : null,
        label: wp.label,
        beat: wp.beat || null,
        shotSize: wp.shotSize || null,
        cameraAngle: wp.cameraAngle || null,
        cameraMove: wp.cameraMove || null,
        focus: wp.focus || null,
        purpose: wp.purpose || null,
        movement: wp.movement || null,
        framing: wp.framing || null,
        notes: wp.notes || null,
        motionCue: wp.motionCue || null,
        duration: wp.duration,
        hold: wp.hold,
        fov: Number.isFinite(wp.fov) ? wp.fov : null
      })),
      waypoints: cloneTourWaypoints(waypoints)
    };
    return waypoints;
  }

  function debugChuangshaProductTour(options = {}) {
    const waypoints = buildChuangshaProductTourOneTake(options);
    return {
      ...(lastObjectTourDebug || {}),
      waypoints: cloneTourWaypoints(waypoints)
    };
  }

  function debugChuangshaScreenInstallation() {
    const rows = [];
    windowReplacementGroups.forEach((group) => {
      if (!group.parent || group.userData.replacementAsset !== "chuangsha") return;
      group.traverse((obj) => {
        if (!obj?.isMesh || obj.userData.chuangshaRole !== "screen") return;
        if (!obj.geometry?.boundingBox) obj.geometry.computeBoundingBox();
        const planeInfo = getGeometryPlaneInfo(obj.geometry);
        const overlays = obj.children.filter((child) => child?.userData?.chuangshaGeneratedOverlay);
        rows.push({
          tag: String(group.userData.replacedWindowTag || ""),
          name: obj.name || null,
          insetApplied: !!obj.userData.chuangshaScreenInsetApplied,
          renderOrder: obj.renderOrder,
          planeAxes: planeInfo.planeAxes.slice(),
          flatAxis: planeInfo.flatAxis,
          localSize: planeInfo.size.toArray().map((n) => +n.toFixed(4)),
          overlayCount: overlays.length,
          lineCount: overlays.filter((child) => child.name === "chuangsha_screen_threads").length,
          retainerCount: overlays.filter((child) => child.name?.startsWith?.("chuangsha_screen_retainer")).length
        });
      });
    });
    return rows;
  }

  function debugChuangshaMotionState(tags = ["181930", "182101"]) {
    const tagSet = tags?.length ? new Set(tags.map((tag) => String(tag))) : null;
    return getChuangshaMotionGroups()
      .filter((group) => !tagSet || tagSet.has(String(group.userData.replacedWindowTag || "")))
      .map((group) => {
        const state = group.userData.chuangshaMotionState || { open: 0, release: 0, stage: "closed" };
        const rig = group.userData.chuangshaMotionRig || null;
        return {
          tag: String(group.userData.replacedWindowTag || ""),
          stage: state.stage,
          open: +Number(state.open || 0).toFixed(3),
          release: +Number(state.release || 0).toFixed(3),
          mechanism: rig?.kind || null,
          openTravel: Number.isFinite(rig?.openTravel) ? +rig.openTravel.toFixed(3) : null,
          movableParts: rig?.parts?.map((part) => ({
            role: part.role,
            name: part.mesh?.name || null,
            visible: !!part.mesh?.visible
          })) || []
        };
      });
  }

  async function replaceWindowsByTagsFromGlb(url = "./chuangsha.glb", tags = ["181930", "182101"], options = {}) {
    clearWindowReplacements();
    clearWindowSelection();
    const asset = await loadChuangshaWindowAsset(url);
    const targets = collectWindowReplacementTargets(tags);
    const sceneCenter = getSceneHorizontalCenter();
    const result = {
      source: url,
      requestedTags: tags.map((tag) => String(tag)),
      totalTargets: targets.length,
      replaced: 0,
      skipped: 0,
      samples: []
    };

    targets.forEach((target) => {
      const group = prepareChuangshaWindowInstance(asset);
      group.name = `replacement:window:${target.tag}:chuangsha`;
      group.userData.system = "architecture";
      group.userData.windowReplacement = true;
      group.userData.replacementAsset = "chuangsha";
      group.userData.replacedWindowTag = target.tag;
      group.userData.replacedExpressID = target.expressID;
      group.visible = systemEnabled.get("architecture") ?? true;
      const fitInfo = fitChuangshaWindowToBox(group, target.box, sceneCenter, options);
      group.userData.chuangshaWidthAxis = fitInfo.widthAxis;
      group.userData.chuangshaDepthAxis = fitInfo.depthAxis;
      group.userData.chuangshaRotationY = fitInfo.rotationY;
      root.add(group);
      windowReplacementGroups.add(group);
      invalidateChuangshaProductCache();
      target.meshes.forEach((mesh) => {
        mesh.userData._windowReplacementHidden = true;
        mesh.visible = false;
        windowReplacedOriginals.add(mesh);
      });
      applyLevelToGroup(group);
      result.replaced++;
      result.samples.push({
        tag: target.tag,
        expressID: target.expressID,
        objectType: target.objectType,
        meshCount: target.meshes.length,
        ...fitInfo
      });
    });

    result.skipped = Math.max(0, result.requestedTags.length - result.replaced);
    markDirty();
    return result;
  }

  function clearWindowReplacements() {
    windowReplacementGroups.forEach((group) => {
      group.traverse((node) => {
        try { node.geometry?.dispose?.(); } catch {}
      });
      root.remove(group);
    });
    windowReplacementGroups.clear();
    invalidateChuangshaProductCache();
    windowReplacedOriginals.forEach((mesh) => {
      delete mesh.userData._windowReplacementHidden;
      mesh.visible = true;
    });
    windowReplacedOriginals.clear();
    root.children.forEach(applyLevelToGroup);
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

  function isRuntimeHiddenMesh(mesh) {
    return !!(mesh?.userData?._semanticReplacementHidden || mesh?.userData?._windowReplacementHidden);
  }

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
      group.traverse((obj) => {
        if (obj.isMesh) obj.visible = !isRuntimeHiddenMesh(obj);
      });
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
      obj.visible = !isRuntimeHiddenMesh(obj) && yMax >= min - 0.12 && yMin < max + 0.12;
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
      "furnitureMetal",
      "furnitureSheer"
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
      "furnitureMetal",
      "furnitureSheer"
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
        transparent: !!mat.transparent,
        opacity: Number.isFinite(mat.opacity) ? +mat.opacity.toFixed(3) : null,
        depthWrite: !!mat.depthWrite,
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

  function getCameraPose() {
    return {
      position: camera.position.toArray(),
      target: controls.target.toArray(),
      fov: camera.fov
    };
  }

  function setCameraPose(pose = {}) {
    const position = Array.isArray(pose.position) ? pose.position : null;
    const target = Array.isArray(pose.target) ? pose.target : null;
    if (position?.length >= 3) camera.position.set(position[0], position[1], position[2]);
    if (target?.length >= 3) controls.target.set(target[0], target[1], target[2]);
    if (Number.isFinite(pose.fov)) {
      camera.fov = Math.max(15, Math.min(80, pose.fov));
      camera.updateProjectionMatrix();
    }
    controls.update();
    markDirty();
  }

  const tourStudioGroup = new THREE.Group();
  tourStudioGroup.name = "tour-studio-overlay";
  tourStudioGroup.visible = true;
  scene.add(tourStudioGroup);

  const tourStudioRailsGroup = new THREE.Group();
  tourStudioRailsGroup.name = "tour-studio-rails";
  const tourStudioNodesGroup = new THREE.Group();
  tourStudioNodesGroup.name = "tour-studio-nodes";
  const tourStudioPlayheadGroup = new THREE.Group();
  tourStudioPlayheadGroup.name = "tour-studio-playhead";
  tourStudioGroup.add(tourStudioRailsGroup, tourStudioNodesGroup, tourStudioPlayheadGroup);

  const tourStudioMaterials = {
    cameraRail: new THREE.LineBasicMaterial({ color: 0x48c7ff, transparent: true, opacity: 0.95, depthTest: false }),
    targetRail: new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.82, depthTest: false }),
    gaze: new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthTest: false }),
    playhead: new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.86, depthTest: false }),
    camera: new THREE.MeshBasicMaterial({ color: 0x48c7ff, depthTest: false }),
    cameraSelected: new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
    target: new THREE.MeshBasicMaterial({ color: 0xffd166, depthTest: false }),
    targetSelected: new THREE.MeshBasicMaterial({ color: 0xfff3b0, depthTest: false }),
    problem: new THREE.MeshBasicMaterial({ color: 0xff5c7a, depthTest: false }),
    playheadCamera: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, depthTest: false }),
    playheadTarget: new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.9, depthTest: false })
  };
  const tourStudioCameraGeometry = new THREE.SphereGeometry(0.055, 16, 10);
  const tourStudioTargetGeometry = new THREE.OctahedronGeometry(0.052, 0);
  const tourStudioProblemGeometry = new THREE.SphereGeometry(0.068, 16, 10);
  const tourStudioPlayheadGeometry = new THREE.SphereGeometry(0.04, 12, 8);
  const tourStudioSharedGeometries = new Set([
    tourStudioCameraGeometry,
    tourStudioTargetGeometry,
    tourStudioProblemGeometry,
    tourStudioPlayheadGeometry
  ]);
  const tourStudioRaycaster = new THREE.Raycaster();
  const tourStudioPointer = new THREE.Vector2();
  const tourStudioTransform = new TransformControls(camera, canvas);
  tourStudioTransform.name = "tour-studio-transform";
  tourStudioTransform.visible = false;
  tourStudioTransform.setMode("translate");
  tourStudioTransform.setSpace("world");
  tourStudioTransform.setSize(0.64);
  scene.add(tourStudioTransform);

  let tourStudioWaypoints = [];
  let tourStudioMarkers = [];
  let tourStudioSelected = null;
  let tourStudioPointerDown = null;
  let tourStudioDragging = false;
  let tourStudioSuppressNextPick = false;
  let tourStudioNodeChangeCallback = null;
  let tourStudioNodeSelectCallback = null;

  function disposeTourStudioObject(obj) {
    obj.traverse?.((node) => {
      if (node.geometry && !tourStudioSharedGeometries.has(node.geometry)) {
        try { node.geometry.dispose(); } catch {}
      }
    });
  }

  function clearTourStudioChildren(group) {
    for (let index = group.children.length - 1; index >= 0; index--) {
      const child = group.children[index];
      group.remove(child);
      disposeTourStudioObject(child);
    }
  }

  function clearTourStudioOverlay() {
    tourStudioTransform.detach();
    tourStudioTransform.visible = false;
    tourStudioSelected = null;
    tourStudioMarkers = [];
    tourStudioWaypoints = [];
    clearTourStudioChildren(tourStudioRailsGroup);
    clearTourStudioChildren(tourStudioNodesGroup);
    clearTourStudioChildren(tourStudioPlayheadGroup);
    markDirty();
  }

  function normalizeTourWaypoint(wp = {}, index = 0) {
    const position = Array.isArray(wp.position) && wp.position.length >= 3
      ? wp.position.slice(0, 3).map(Number)
      : null;
    const target = Array.isArray(wp.target) && wp.target.length >= 3
      ? wp.target.slice(0, 3).map(Number)
      : null;
    return {
      ...wp,
      id: wp.id || `shot_${String(index + 1).padStart(2, "0")}`,
      label: wp.label || `Shot ${index + 1}`,
      time: Number.isFinite(wp.time) ? Number(wp.time) : null,
      duration: Number.isFinite(wp.duration) ? Number(wp.duration) : 1.5,
      hold: Number.isFinite(wp.hold) ? Number(wp.hold) : 0,
      fov: Number.isFinite(wp.fov) ? Number(wp.fov) : null,
      position,
      target
    };
  }

  function normalizeTourStudioWaypoints(waypoints = []) {
    return (Array.isArray(waypoints) ? waypoints : [])
      .map((wp, index) => normalizeTourWaypoint(wp, index));
  }

  function diagnoseTourStudioWaypoints(waypoints = []) {
    const normalized = normalizeTourStudioWaypoints(waypoints);
    const segments = [];
    const issues = [];
    const shotScores = [];
    let previousSpeed = null;
    const hintedTag = normalized
      .map((wp) => wp?.subject?.tag ?? wp?.productTag ?? null)
      .find((value) => value != null);
    const products = collectChuangshaWindowProducts(hintedTag != null ? [String(hintedTag)] : []);
    const product = products[0] || null;

    normalized.forEach((wp, index) => {
      if (!wp.position) issues.push({ index, severity: "error", message: "missing camera position" });
      if (!wp.target) issues.push({ index, severity: "error", message: "missing target" });
      if (!wp.position || !wp.target) return;
      const pos = new THREE.Vector3(...wp.position);
      const tgt = new THREE.Vector3(...wp.target);
      const targetDistance = pos.distanceTo(tgt);
      const shotIssues = [];
      let shotScore = 100;
      const pushShotIssue = (severity, message, penalty = 0) => {
        if (penalty > 0) shotScore -= penalty;
        const issue = { index, severity, message };
        shotIssues.push(issue);
        issues.push(issue);
      };
      if (targetDistance < 0.08) {
        pushShotIssue("warn", "camera too close to target", 10);
      }
      if (targetDistance > 12) {
        pushShotIssue("warn", "target is very far from camera", 14);
      }

      if (product) {
        const focusInfo = resolveChuangshaFocusAnchor(product, wp.focus || wp.focusKey || "window");
        const focusCenter = focusInfo.anchor?.center || product.center;
        const focusDistance = tgt.distanceTo(focusCenter);
        const productTargetDistance = product.box.distanceToPoint(tgt);
        const cameraFocusDistance = pos.distanceTo(focusCenter);
        const interiorDepth = pos.clone().sub(product.center).dot(product.inward);
        const targetInteriorDepth = tgt.clone().sub(product.center).dot(product.inward);
        const lowerHeight = product.box.min.y + product.size.y * 0.38;
        const upperHeight = product.box.min.y + product.size.y * 0.6;
        const strongFocusMiss = focusDistance > focusInfo.tolerance * 1.8;
        const mildFocusMiss = !strongFocusMiss && focusDistance > focusInfo.tolerance;
        let subjectLocked = true;

        if (productTargetDistance > Math.max(product.semanticAnchors?.anchors?.window?.radius || 0.18, 0.32)) {
          pushShotIssue("warn", "look target has drifted away from the window product", 28);
          subjectLocked = false;
        } else if (productTargetDistance > 0.16) {
          pushShotIssue("warn", "look target is slipping off the product", 12);
        }

        if (strongFocusMiss) {
          pushShotIssue("warn", `focus is missing the ${focusInfo.label}`, 22);
          subjectLocked = false;
        } else if (mildFocusMiss) {
          pushShotIssue("warn", `focus is drifting off the ${focusInfo.label}`, 10);
        }

        if (focusInfo.insideOnly && interiorDepth < -0.02) {
          pushShotIssue("warn", "camera drifted to the exterior side of the window", 30);
          subjectLocked = false;
        } else if (focusInfo.insideOnly && interiorDepth < 0.08) {
          pushShotIssue("warn", "camera is hugging the window plane too tightly", 12);
        }

        if (focusInfo.insideOnly && targetInteriorDepth < -0.04) {
          pushShotIssue("warn", "look target slipped toward the outside", 16);
        }

        if (focusInfo.detail && cameraFocusDistance > focusInfo.idealMax) {
          pushShotIssue("warn", `camera is too far to read the ${focusInfo.label}`, 14);
        } else if (focusInfo.whole && cameraFocusDistance < focusInfo.idealMin) {
          pushShotIssue("warn", `camera is too close to show the full ${focusInfo.label}`, 10);
        }

        if ((focusInfo.key === "button" || focusInfo.key === "display" || focusInfo.key === "bottom") && pos.y > upperHeight) {
          pushShotIssue("warn", "camera is too high for the bottom controls", 10);
        }
        if (focusInfo.key === "top" && pos.y < lowerHeight) {
          pushShotIssue("warn", "camera is too low to read the top edge", 10);
        }

        if (Number.isFinite(wp.fov) && focusInfo.detail && wp.fov > 30) {
          pushShotIssue("warn", "lens feels too wide for a product detail shot", 8);
        }
        if (Number.isFinite(wp.fov) && focusInfo.whole && focusInfo.key !== "room" && wp.fov < 18) {
          pushShotIssue("warn", "lens feels too tight for a full product read", 8);
        }

        shotScore = Math.max(0, Math.min(100, Math.round(shotScore)));
        shotScores.push({
          index,
          score: shotScore,
          rating: shotScore >= 88 ? "hero-ready" : shotScore >= 74 ? "usable" : shotScore >= 58 ? "needs work" : "off-product",
          headline: shotIssues[0]?.message || `good lock on ${focusInfo.label}`,
          focus: focusInfo.key,
          focusLabel: focusInfo.label,
          focusDistance: +focusDistance.toFixed(3),
          targetProductDistance: +productTargetDistance.toFixed(3),
          cameraFocusDistance: +cameraFocusDistance.toFixed(3),
          interiorDepth: +interiorDepth.toFixed(3),
          subjectLocked
        });
      }

      if (index > 0) {
        const prev = normalized[index - 1];
        if (prev.position) {
          const prevPos = new THREE.Vector3(...prev.position);
          const length = prevPos.distanceTo(pos);
          const duration = Math.max(0.05, wp.duration ?? 1.5);
          const speed = length / duration;
          const speedRatio = previousSpeed && previousSpeed > 0.001 ? speed / previousSpeed : 1;
          const segment = {
            from: index - 1,
            to: index,
            length: +length.toFixed(3),
            duration: +duration.toFixed(3),
            speed: +speed.toFixed(3),
            speedRatio: +speedRatio.toFixed(2)
          };
          segments.push(segment);
          if (length < 0.03) {
            pushShotIssue("warn", "segment has almost no camera movement", 6);
          }
          if (speedRatio > 2.8 || speedRatio < 0.36) {
            pushShotIssue("warn", `speed jump ${segment.speedRatio}x`, 10);
          }
          previousSpeed = speed;
        }
      }

      if (!product) {
        shotScores.push({
          index,
          score: Math.max(0, Math.min(100, Math.round(shotScore))),
          rating: shotScore >= 84 ? "usable" : "needs work",
          headline: shotIssues[0]?.message || "path looks stable",
          focus: String(wp.focus || wp.focusKey || "window").toLowerCase(),
          focusLabel: String(wp.focus || wp.focusKey || "window"),
          focusDistance: null,
          targetProductDistance: null,
          cameraFocusDistance: +targetDistance.toFixed(3),
          interiorDepth: null,
          subjectLocked: shotIssues.length === 0
        });
      }
    });

    const avgScore = shotScores.length
      ? shotScores.reduce((sum, item) => sum + (Number(item.score) || 0), 0) / shotScores.length
      : null;
    return {
      count: normalized.length,
      duration: normalized.some((wp) => Number.isFinite(wp.time))
        ? Math.max(...normalized.map((wp) => Number.isFinite(wp.time) ? wp.time : 0), 0)
        : normalized.reduce((sum, wp, index) => sum + (index === 0 ? 0 : Math.max(0, wp.duration || 0)) + Math.max(0, wp.hold || 0), 0),
      segments,
      issues,
      shotScores,
      product: product ? {
        tag: product.tag,
        rolesPresent: product.semanticAnchors?.rolesPresent || [],
        hasScreen: !!product.semanticAnchors?.anchors?.screen,
        hasDisplay: !!product.semanticAnchors?.anchors?.display,
        hasButton: !!product.semanticAnchors?.anchors?.button
      } : null,
      summary: {
        errors: issues.filter((item) => item.severity === "error").length,
        warnings: issues.filter((item) => item.severity === "warn").length,
        avgScore: avgScore == null ? null : +avgScore.toFixed(1),
        strongShots: shotScores.filter((item) => Number(item.score) >= 85).length,
        weakShots: shotScores.filter((item) => Number(item.score) < 70).length,
        subjectLocked: shotScores.filter((item) => item.subjectLocked).length
      }
    };
  }

  function makeTourStudioCurves(waypoints = tourStudioWaypoints) {
    const normalized = normalizeTourStudioWaypoints(waypoints)
      .filter((wp) => wp.position && wp.target);
    if (normalized.length < 2) {
      return {
        waypoints: normalized,
        cameraCurve: null,
        targetCurve: null,
        segmentCount: Math.max(0, normalized.length - 1)
      };
    }
    return {
      waypoints: normalized,
      cameraCurve: new THREE.CatmullRomCurve3(
        normalized.map((wp) => new THREE.Vector3(...wp.position)),
        false,
        "centripetal",
        0.28
      ),
      targetCurve: new THREE.CatmullRomCurve3(
        normalized.map((wp) => new THREE.Vector3(...wp.target)),
        false,
        "centripetal",
        0.28
      ),
      segmentCount: normalized.length - 1
    };
  }

  function makeTourStudioLine(name, points, material) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    line.name = name;
    line.renderOrder = 10000;
    line.frustumCulled = false;
    return line;
  }

  function tourStudioMaterialForNode(kind, selected, hasIssue) {
    if (hasIssue && kind === "camera") return tourStudioMaterials.problem;
    if (kind === "camera") return selected ? tourStudioMaterials.cameraSelected : tourStudioMaterials.camera;
    return selected ? tourStudioMaterials.targetSelected : tourStudioMaterials.target;
  }

  function createTourStudioNode(kind, wp, index, diagnostics) {
    const selected = tourStudioSelected?.index === index && tourStudioSelected?.kind === kind;
    const hasIssue = diagnostics.issues.some((item) => item.index === index);
    const geometry = hasIssue && kind === "camera"
      ? tourStudioProblemGeometry
      : (kind === "camera" ? tourStudioCameraGeometry : tourStudioTargetGeometry);
    const marker = new THREE.Mesh(
      geometry,
      tourStudioMaterialForNode(kind, selected, hasIssue)
    );
    marker.name = `tour-studio-${kind}-${index + 1}`;
    marker.position.fromArray(kind === "camera" ? wp.position : wp.target);
    marker.renderOrder = 10002;
    marker.frustumCulled = false;
    marker.userData.tourStudioNode = { kind, index };
    tourStudioNodesGroup.add(marker);
    tourStudioMarkers.push(marker);
    return marker;
  }

  function redrawTourStudioRails() {
    clearTourStudioChildren(tourStudioRailsGroup);
    const normalized = normalizeTourStudioWaypoints(tourStudioWaypoints)
      .filter((wp) => wp.position && wp.target);

    if (normalized.length >= 2) {
      const { cameraCurve, targetCurve } = makeTourStudioCurves(normalized);
      const divisions = Math.max(48, normalized.length * 18);
      tourStudioRailsGroup.add(makeTourStudioLine(
        "tour-studio-camera-rail",
        cameraCurve.getPoints(divisions),
        tourStudioMaterials.cameraRail
      ));
      tourStudioRailsGroup.add(makeTourStudioLine(
        "tour-studio-target-rail",
        targetCurve.getPoints(divisions),
        tourStudioMaterials.targetRail
      ));
    }

    normalized.forEach((wp, index) => {
      tourStudioRailsGroup.add(makeTourStudioLine(
        `tour-studio-gaze-${index + 1}`,
        [new THREE.Vector3(...wp.position), new THREE.Vector3(...wp.target)],
        tourStudioMaterials.gaze
      ));
    });
  }

  function rebuildTourStudioOverlay() {
    clearTourStudioChildren(tourStudioNodesGroup);
    tourStudioMarkers = [];
    const diagnostics = diagnoseTourStudioWaypoints(tourStudioWaypoints);
    const normalized = normalizeTourStudioWaypoints(tourStudioWaypoints)
      .filter((wp) => wp.position && wp.target);

    redrawTourStudioRails();

    normalized.forEach((wp, index) => {
      createTourStudioNode("camera", wp, index, diagnostics);
      createTourStudioNode("target", wp, index, diagnostics);
    });

    const selectedMarker = tourStudioMarkers.find((marker) => {
      const node = marker.userData.tourStudioNode;
      return node?.index === tourStudioSelected?.index && node?.kind === tourStudioSelected?.kind;
    });
    if (selectedMarker) {
      tourStudioTransform.attach(selectedMarker);
      tourStudioTransform.visible = true;
    } else {
      tourStudioTransform.detach();
      tourStudioTransform.visible = false;
      tourStudioSelected = null;
    }
    markDirty();
    return diagnostics;
  }

  function showTourStudioOverlay(waypoints = [], options = {}) {
    tourStudioTransform.detach();
    tourStudioTransform.visible = false;
    tourStudioSelected = Number.isInteger(options.selectedIndex)
      ? { index: options.selectedIndex, kind: options.selectedKind === "target" ? "target" : "camera" }
      : tourStudioSelected;
    tourStudioWaypoints = normalizeTourStudioWaypoints(waypoints);
    tourStudioNodeChangeCallback = typeof options.onNodeChange === "function" ? options.onNodeChange : tourStudioNodeChangeCallback;
    tourStudioNodeSelectCallback = typeof options.onNodeSelect === "function" ? options.onNodeSelect : tourStudioNodeSelectCallback;
    tourStudioGroup.visible = options.visible !== false;
    clearTourStudioChildren(tourStudioPlayheadGroup);
    return rebuildTourStudioOverlay();
  }

  function setTourStudioOverlayVisible(visible = true) {
    tourStudioGroup.visible = !!visible;
    tourStudioTransform.visible = !!visible && !!tourStudioTransform.object;
    markDirty();
    return tourStudioGroup.visible;
  }

  function setTourStudioSelection(index = 0, kind = "camera") {
    const safeIndex = Math.max(0, Math.min(tourStudioWaypoints.length - 1, Number(index) || 0));
    tourStudioSelected = tourStudioWaypoints.length
      ? { index: safeIndex, kind: kind === "target" ? "target" : "camera" }
      : null;
    rebuildTourStudioOverlay();
    if (tourStudioSelected) {
      tourStudioNodeSelectCallback?.({
        ...tourStudioSelected,
        waypoint: cloneTourWaypoints([tourStudioWaypoints[tourStudioSelected.index]])[0]
      });
    }
    return tourStudioSelected;
  }

  function sampleTourStudioPoseAt(progress = 0, options = {}) {
    const { waypoints, cameraCurve, targetCurve, segmentCount } = makeTourStudioCurves(tourStudioWaypoints);
    if (!waypoints.length) return null;
    if (!cameraCurve || !targetCurve || segmentCount <= 0) {
      const first = waypoints[0];
      return {
        position: first.position?.slice(),
        target: first.target?.slice(),
        fov: first.fov ?? camera.fov,
        progress: 0,
        curveT: 0
      };
    }
    const p = Math.max(0, Math.min(1, Number(progress) || 0));
    const totalDuration = Math.max(0.001, Number(options.duration) || diagnoseTourStudioWaypoints(waypoints).duration || 1);
    const timings = waypoints.map((wp, index) => {
      if (Number.isFinite(wp.at)) return Math.max(0, Math.min(1, wp.at));
      if (Number.isFinite(wp.time)) return Math.max(0, Math.min(1, wp.time / totalDuration));
      return index / segmentCount;
    });
    const monotonic = timings[0] === 0
      && timings[timings.length - 1] === 1
      && timings.every((value, index) => index === 0 || value >= timings[index - 1]);
    let curveT = p;
    if (monotonic) {
      let index = 0;
      while (index < timings.length - 2 && p > timings[index + 1]) index++;
      const start = timings[index];
      const end = Math.max(start + 0.0001, timings[index + 1]);
      const local = Math.max(0, Math.min(1, (p - start) / (end - start)));
      const eased = local * local * (3 - 2 * local);
      curveT = Math.max(0, Math.min(1, (index + eased) / segmentCount));
    }
    const position = cameraCurve.getPoint(curveT);
    const target = targetCurve.getPoint(curveT);
    const fovValues = waypoints.map((wp) => Number.isFinite(wp.fov) ? wp.fov : camera.fov);
    const scaled = curveT * segmentCount;
    const fovIndex = Math.min(waypoints.length - 2, Math.max(0, Math.floor(scaled)));
    const fovLocal = Math.max(0, Math.min(1, scaled - fovIndex));
    return {
      position: position.toArray(),
      target: target.toArray(),
      fov: THREE.MathUtils.lerp(fovValues[fovIndex], fovValues[fovIndex + 1], fovLocal * fovLocal * (3 - 2 * fovLocal)),
      progress: p,
      curveT
    };
  }

  function renderTourStudioPlayhead(pose) {
    clearTourStudioChildren(tourStudioPlayheadGroup);
    if (!pose?.position || !pose?.target) return;
    const pos = new THREE.Vector3(...pose.position);
    const tgt = new THREE.Vector3(...pose.target);
    const camMarker = new THREE.Mesh(tourStudioPlayheadGeometry, tourStudioMaterials.playheadCamera);
    camMarker.name = "tour-studio-playhead-camera";
    camMarker.position.copy(pos);
    camMarker.renderOrder = 10004;
    camMarker.frustumCulled = false;
    tourStudioPlayheadGroup.add(camMarker);
    const tgtMarker = new THREE.Mesh(tourStudioPlayheadGeometry, tourStudioMaterials.playheadTarget);
    tgtMarker.name = "tour-studio-playhead-target";
    tgtMarker.position.copy(tgt);
    tgtMarker.renderOrder = 10004;
    tgtMarker.frustumCulled = false;
    tourStudioPlayheadGroup.add(tgtMarker);
    tourStudioPlayheadGroup.add(makeTourStudioLine("tour-studio-playhead-gaze", [pos, tgt], tourStudioMaterials.playhead));
  }

  function previewTourStudioAt(progress = 0, options = {}) {
    const pose = sampleTourStudioPoseAt(progress, options);
    if (!pose) return null;
    if (options.applyCamera !== false) setCameraPose(pose);
    renderTourStudioPlayhead(pose);
    markDirty();
    return pose;
  }

  function setTourStudioNodeChangeHandler(handler) {
    tourStudioNodeChangeCallback = typeof handler === "function" ? handler : null;
  }

  function setTourStudioNodeSelectHandler(handler) {
    tourStudioNodeSelectCallback = typeof handler === "function" ? handler : null;
  }

  function notifyTourStudioNodeChange(phase = "change") {
    if (!tourStudioSelected || !tourStudioTransform.object) return;
    const wp = tourStudioWaypoints[tourStudioSelected.index];
    if (!wp) return;
    const value = tourStudioTransform.object.position.toArray().map((n) => +n.toFixed(3));
    if (tourStudioSelected.kind === "target") wp.target = value;
    else wp.position = value;
    tourStudioNodeChangeCallback?.({
      ...tourStudioSelected,
      phase,
      value: value.slice(),
      waypoint: cloneTourWaypoints([wp])[0]
    });
    if (phase === "drag") redrawTourStudioRails();
    markDirty();
  }

  function pickTourStudioNode(event) {
    if (!tourStudioGroup.visible || !tourStudioMarkers.length) return false;
    const rect = canvas.getBoundingClientRect();
    tourStudioPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    tourStudioPointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    tourStudioRaycaster.setFromCamera(tourStudioPointer, camera);
    const hits = tourStudioRaycaster.intersectObjects(tourStudioMarkers, false);
    const hit = hits.find((item) => item.object?.userData?.tourStudioNode);
    if (!hit) return false;
    const node = hit.object.userData.tourStudioNode;
    setTourStudioSelection(node.index, node.kind);
    return true;
  }

  tourStudioTransform.addEventListener("change", markDirty);
  tourStudioTransform.addEventListener("mouseDown", () => {
    tourStudioDragging = true;
    tourStudioSuppressNextPick = true;
    controls.enabled = false;
  });
  tourStudioTransform.addEventListener("mouseUp", () => {
    notifyTourStudioNodeChange("commit");
    tourStudioDragging = false;
    controls.enabled = true;
    rebuildTourStudioOverlay();
    window.setTimeout(() => {
      tourStudioSuppressNextPick = false;
    }, 0);
  });
  tourStudioTransform.addEventListener("dragging-changed", (event) => {
    tourStudioDragging = !!event.value;
    controls.enabled = !event.value;
  });
  tourStudioTransform.addEventListener("objectChange", () => {
    notifyTourStudioNodeChange("drag");
  });

  function clearAll() {
    // Reject any in-flight worker jobs so awaiters don't hang.
    pendingJobs.forEach((job) => job.reject(new Error("renderer cleared")));
    pendingJobs.clear();
    replacementGroups.clear();
    replacedOriginals.clear();
    windowReplacementGroups.clear();
    invalidateChuangshaProductCache();
    windowReplacedOriginals.clear();
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
  const TOUR_LEVEL_RANGE = { min: 3.1, max: 6.0 };
  const TOUR_WINDOW_IFC_TYPES = new Set([3304561284, 486154966]);
  let lastObjectTourDebug = null;

  function tourBoxIntersectsLevel(box, range = TOUR_LEVEL_RANGE) {
    return finiteBox(box) && box.max.y >= range.min - 0.12 && box.min.y <= range.max + 0.12;
  }

  function tourBoxCenter(box, yRatio = 0.55) {
    const size = box.getSize(new THREE.Vector3());
    return new THREE.Vector3(
      (box.min.x + box.max.x) * 0.5,
      box.min.y + size.y * yRatio,
      (box.min.z + box.max.z) * 0.5
    );
  }

  function tourFocusTarget(item) {
    const box = item.box;
    const size = box.getSize(new THREE.Vector3());
    const target = tourBoxCenter(box, item.category === "window" ? 0.5 : 0.6);
    if (item.category === "bed") {
      target.y = Math.min(box.max.y - 0.06, box.min.y + Math.max(0.38, Math.min(0.82, size.y * 0.78)));
    } else if (item.category === "table") {
      target.y = Math.min(box.max.y - 0.03, box.min.y + Math.max(0.32, size.y * 0.75));
    } else if (item.category === "sofa" || item.category === "chair") {
      target.y = Math.min(box.max.y - 0.05, box.min.y + Math.max(0.42, size.y * 0.66));
    }
    return target;
  }

  function collectTourWindows(range = TOUR_LEVEL_RANGE) {
    const byKey = new Map();
    root.traverse((obj) => {
      if (!obj.isMesh || !TOUR_WINDOW_IFC_TYPES.has(obj.userData.ifcType)) return;
      const box = new THREE.Box3().setFromObject(obj);
      if (!tourBoxIntersectsLevel(box, range)) return;
      const size = box.getSize(new THREE.Vector3());
      if (size.y < 0.35 || Math.max(size.x, size.z) < 0.35) return;
      const key = obj.userData.expressID != null ? String(obj.userData.expressID) : obj.uuid;
      let item = byKey.get(key);
      if (!item) {
        item = { key, category: "window", box: new THREE.Box3(), meshes: [] };
        byKey.set(key, item);
      }
      item.box.union(box);
      item.meshes.push(obj);
    });
    return Array.from(byKey.values()).map((item) => ({
      ...item,
      center: tourFocusTarget(item),
      size: item.box.getSize(new THREE.Vector3())
    }));
  }

  function collectTourFurniture(range = TOUR_LEVEL_RANGE) {
    const items = [];
    replacementGroups.forEach((group) => {
      if (!group.parent) return;
      const category = group.userData.replacementCategory;
      if (!["bed", "sofa", "chair", "table"].includes(category)) return;
      const box = new THREE.Box3().setFromObject(group);
      if (!tourBoxIntersectsLevel(box, range)) return;
      const size = box.getSize(new THREE.Vector3());
      if (Math.max(size.x, size.z) < 0.2) return;
      items.push({ category, box, size, center: tourFocusTarget({ category, box }) });
    });

    collectFurnitureReplacementTargets().forEach((target) => {
      if (!tourBoxIntersectsLevel(target.box, range)) return;
      const size = target.box.getSize(new THREE.Vector3());
      if (items.some((item) => item.category === target.category && item.box.clone().expandByScalar(0.08).intersectsBox(target.box))) return;
      items.push({
        category: target.category,
        box: target.box.clone(),
        size,
        center: tourFocusTarget({ category: target.category, box: target.box })
      });
    });

    return items;
  }

  function weightedTourCenter(items) {
    const center = new THREE.Vector3();
    let weight = 0;
    items.forEach((item) => {
      const w = tourItemWeight(item);
      center.addScaledVector(item.center, w);
      weight += w;
    });
    return weight > 0 ? center.multiplyScalar(1 / weight) : null;
  }

  function tourItemWeight(item) {
    if (item.category === "bed") return 3.2;
    if (item.category === "sofa") return 2.4;
    if (item.category === "table") return 1.8;
    if (item.category === "chair") return 1.35;
    return 1;
  }

  function tourItemFootprint(item) {
    return Math.max(item.size?.x || 0, item.size?.z || 0);
  }

  function makeTourWaypoint(label, cameraPoint, targetPoint, duration = 1.5) {
    return {
      label,
      position: [
        +cameraPoint.x.toFixed(3),
        +cameraPoint.y.toFixed(3),
        +cameraPoint.z.toFixed(3)
      ],
      target: [
        +targetPoint.x.toFixed(3),
        +targetPoint.y.toFixed(3),
        +targetPoint.z.toFixed(3)
      ],
      duration,
      hold: 0
    };
  }

  function cloneTourWaypoints(waypoints = []) {
    return waypoints.map((wp) => ({
      ...wp,
      position: wp.position?.slice(),
      target: wp.target?.slice()
    }));
  }

  function summarizeTourItem(item, extra = {}) {
    return {
      category: item.category,
      key: item.key || item.name || item.uuid || null,
      center: item.center ? item.center.toArray().map((n) => +n.toFixed(3)) : null,
      size: item.size ? item.size.toArray().map((n) => +n.toFixed(3)) : null,
      box: item.box ? boxSnapshot(item.box) : null,
      ...extra
    };
  }

  function scoreWindowFurnitureCluster(windowItem, furniture) {
    const maxDistance = 7.2;
    const candidates = furniture
      .map((item) => {
        const distance = horizontalDistance(windowItem.center, item.center);
        const verticalGap = Math.abs(windowItem.center.y - item.center.y);
        if (distance > maxDistance || verticalGap > 1.8) return null;
        const near = Math.max(0, 1 - distance / maxDistance);
        const sizeScore = Math.min(2.4, tourItemFootprint(item));
        return {
          item,
          distance,
          score: tourItemWeight(item) * (0.32 + near * near * 1.75) + sizeScore * 0.18
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.distance - b.distance);

    const coverage = new Set(candidates.slice(0, 8).map((entry) => entry.item.category)).size;
    const windowArea = Math.min(3, Math.max(windowItem.size.x, windowItem.size.z) * windowItem.size.y);
    const score = candidates.slice(0, 8).reduce((sum, entry) => sum + entry.score, 0)
      + coverage * 0.75
      + windowArea * 0.2
      + (candidates.some((entry) => entry.item.category === "bed") ? 0.75 : 0);
    return { windowItem, candidates, score };
  }

  function chooseTourWindowCluster(windows, furniture) {
    return windows
      .map((windowItem) => scoreWindowFurnitureCluster(windowItem, furniture))
      .filter((cluster) => cluster.candidates.length)
      .sort((a, b) => b.score - a.score)[0] || null;
  }

  function selectTourItemsForWindow(cluster) {
    const windowItem = cluster.windowItem;
    const clusterItems = cluster.candidates.map((entry) => entry.item);
    const clusterCenter = weightedTourCenter(clusterItems);
    if (!clusterCenter) return null;

    const inward = clusterCenter.clone().sub(windowItem.center);
    inward.y = 0;
    if (inward.lengthSq() < 0.0001) inward.set(-1, 0, 0);
    inward.normalize();
    const lateral = new THREE.Vector3(-inward.z, 0, inward.x).normalize();

    const entries = cluster.candidates
      .map((entry) => {
        const offset = entry.item.center.clone().sub(windowItem.center);
        offset.y = 0;
        const depth = offset.dot(inward);
        const lateralDistance = Math.abs(offset.dot(lateral));
        return { ...entry, depth, lateralDistance };
      })
      .filter((entry) => {
        const roomWidth = Math.max(2.1, Math.min(3.8, entry.depth * 0.55 + 1.35));
        return entry.depth > 0.12 && entry.lateralDistance <= roomWidth;
      });
    const sourceEntries = entries.length ? entries : cluster.candidates.map((entry) => ({
      ...entry,
      depth: horizontalDistance(entry.item.center, windowItem.center),
      lateralDistance: 0
    }));

    const used = new Set();
    const selectedEntries = [];
    ["bed", "table", "sofa", "chair"].forEach((category) => {
      const best = sourceEntries
        .filter((entry) => entry.item.category === category && !used.has(entry.item))
        .sort((a, b) => b.score - a.score || a.depth - b.depth)[0];
      if (best) {
        selectedEntries.push(best);
        used.add(best.item);
      }
    });
    sourceEntries
      .filter((entry) => !used.has(entry.item))
      .sort((a, b) => b.score - a.score || a.depth - b.depth)
      .slice(0, Math.max(0, 5 - selectedEntries.length))
      .forEach((entry) => {
        selectedEntries.push(entry);
        used.add(entry.item);
      });

    selectedEntries.sort((a, b) => a.depth - b.depth || b.score - a.score);
    return {
      windowItem,
      inward,
      lateral,
      entries: selectedEntries,
      candidateCount: cluster.candidates.length,
      score: cluster.score
    };
  }

  function buildWindowObjectTour(selection, range = TOUR_LEVEL_RANGE) {
    const selected = selection.entries.map((entry) => entry.item);
    const furnitureCenter = weightedTourCenter(selected) || selected[0]?.center;
    if (!furnitureCenter) return null;

    const { windowItem, inward, lateral } = selection;
    const maxDepth = Math.max(1.15, ...selection.entries.map((entry) => entry.depth));
    const cameraHeight = THREE.MathUtils.clamp(windowItem.center.y + 0.02, range.min + 1.32, range.max - 0.46);
    const objectHeight = THREE.MathUtils.clamp(furnitureCenter.y + 0.68, range.min + 1.26, range.max - 0.52);
    const windowTarget = windowItem.center.clone().addScaledVector(inward, 0.04);
    const depthEntries = selection.entries
      .slice(0, 7)
      .sort((a, b) => a.depth - b.depth || b.score - a.score);
    const priorityEntries = selection.entries
      .slice(0, 7)
      .sort((a, b) => {
        const ap = a.item.category === "bed" ? 0 : a.item.category === "table" ? 1 : a.item.category === "sofa" ? 2 : 3;
        const bp = b.item.category === "bed" ? 0 : b.item.category === "table" ? 1 : b.item.category === "sofa" ? 2 : 3;
        return ap - bp || a.depth - b.depth;
      });
    const firstEntry = priorityEntries[0] || depthEntries[0];
    const midEntry = depthEntries[Math.min(depthEntries.length - 1, Math.max(1, Math.floor(depthEntries.length * 0.48)))] || firstEntry;
    const farEntry = depthEntries[depthEntries.length - 1] || midEntry || firstEntry;
    const firstObject = firstEntry?.item || selected[0];
    const secondObject = midEntry?.item || selected[1] || firstObject;
    const farObject = farEntry?.item || secondObject;
    const objectFocus = firstObject.center.clone();
    const objectPairFocus = weightedTourCenter([firstObject, secondObject].filter(Boolean)) || objectFocus;
    const farFocus = weightedTourCenter([secondObject, farObject].filter(Boolean)) || farObject.center.clone();
    const turnFocus = windowTarget.clone().lerp(objectFocus, 0.42);
    turnFocus.y = THREE.MathUtils.clamp(objectFocus.y + 0.16, range.min + 0.95, range.max - 0.85);
    const depthAt = (ratio, min, max) => THREE.MathUtils.clamp(maxDepth * ratio, min, max);
    const windowHalfWidth = Math.max(0.36, Math.min(0.86, Math.max(windowItem.size.x, windowItem.size.z) * 0.32));
    const windowLeft = windowTarget.clone().addScaledVector(lateral, -windowHalfWidth);
    const windowRight = windowTarget.clone().addScaledVector(lateral, windowHalfWidth);
    const windowHigh = windowItem.center.clone();
    windowHigh.y = Math.min(windowItem.box.max.y - 0.08, windowItem.center.y + Math.max(0.2, windowItem.size.y * 0.28));
    const windowLow = windowItem.center.clone();
    windowLow.y = Math.max(windowItem.box.min.y + 0.08, windowItem.center.y - Math.max(0.14, windowItem.size.y * 0.24));
    const windowFullFace = windowTarget.clone().addScaledVector(inward, 0.04);
    const windowDepthTarget = windowTarget.clone().lerp(turnFocus, 0.2);
    windowDepthTarget.y = THREE.MathUtils.clamp(windowItem.center.y + 0.03, range.min + 1.02, range.max - 0.78);

    const waypoints = [
      makeTourWaypoint(
        "window low approach",
        windowTarget.clone().addScaledVector(inward, 0.64).addScaledVector(lateral, -windowHalfWidth * 0.52).setY(cameraHeight - 0.18),
        windowLow.clone().addScaledVector(inward, 0.02).addScaledVector(lateral, -windowHalfWidth * 0.18),
        0.01
      ),
      makeTourWaypoint(
        "window left profile",
        windowTarget.clone().addScaledVector(inward, 0.52).addScaledVector(lateral, -windowHalfWidth * 0.78).setY(cameraHeight + 0.03),
        windowLeft.clone().lerp(windowHigh, 0.28).addScaledVector(inward, 0.02),
        1.25
      ),
      makeTourWaypoint(
        "window glass face",
        windowTarget.clone().addScaledVector(inward, 0.58).addScaledVector(lateral, -windowHalfWidth * 0.14).setY(cameraHeight + 0.01),
        windowFullFace,
        1.38
      ),
      makeTourWaypoint(
        "window right profile",
        windowTarget.clone().addScaledVector(inward, 0.66).addScaledVector(lateral, windowHalfWidth * 0.68).setY(cameraHeight),
        windowRight.clone().lerp(windowHigh, 0.18).addScaledVector(inward, 0.02),
        1.34
      ),
      makeTourWaypoint(
        "window top frame",
        windowTarget.clone().addScaledVector(inward, 0.78).addScaledVector(lateral, windowHalfWidth * 0.36).setY(cameraHeight + 0.16),
        windowHigh.clone().addScaledVector(inward, 0.02),
        1.22
      ),
      makeTourWaypoint(
        "window full reveal",
        windowTarget.clone().addScaledVector(inward, 1.04).addScaledVector(lateral, 0.08).setY(cameraHeight + 0.02),
        windowDepthTarget,
        1.45
      ),
      makeTourWaypoint(
        "window thickness to room",
        windowTarget.clone().addScaledVector(inward, 1.28).addScaledVector(lateral, -0.04).setY(cameraHeight - 0.03),
        windowTarget.clone().lerp(turnFocus, 0.42),
        1.58
      ),
      makeTourWaypoint(
        "turn from window into room",
        windowTarget.clone().addScaledVector(inward, 1.46).addScaledVector(lateral, 0.05).setY(cameraHeight - 0.04),
        turnFocus,
        1.65
      ),
      makeTourWaypoint(
        `${firstObject.category} beside window hold`,
        windowTarget.clone()
          .addScaledVector(inward, depthAt(0.44, 1.14, 1.84))
          .addScaledVector(lateral, -0.08)
          .setY(objectHeight),
        objectFocus,
        1.46
      ),
      makeTourWaypoint(
        "sideways room transition",
        windowTarget.clone()
          .addScaledVector(inward, depthAt(0.62, 1.42, 2.28))
          .addScaledVector(lateral, 0.16)
          .setY(objectHeight),
        objectPairFocus.clone().lerp(windowTarget, 0.18),
        1.62
      ),
      makeTourWaypoint(
        `${secondObject.category} depth hold`,
        windowTarget.clone()
          .addScaledVector(inward, depthAt(0.76, 1.68, 2.64))
          .addScaledVector(lateral, -0.1)
          .setY(objectHeight + 0.02),
        secondObject.center.clone(),
        1.54
      ),
      makeTourWaypoint(
        "long room depth",
        windowTarget.clone()
          .addScaledVector(inward, depthAt(0.92, 2.02, 3.22))
          .addScaledVector(lateral, 0.08)
          .setY(objectHeight + 0.05),
        farFocus,
        1.74
      ),
      makeTourWaypoint(
        `${farObject.category} far focus`,
        windowTarget.clone()
          .addScaledVector(inward, depthAt(1.06, 2.28, 3.58))
          .addScaledVector(lateral, -0.04)
          .setY(objectHeight + 0.04),
        farObject.center.clone(),
        1.46
      ),
      makeTourWaypoint(
        "window and room finish",
        windowTarget.clone()
          .addScaledVector(inward, depthAt(1.18, 2.58, 3.96))
          .addScaledVector(lateral, 0.08)
          .setY(objectHeight + 0.1),
        windowTarget.clone().lerp(farFocus, 0.62),
        1.62
      )
    ];
    waypoints[1].hold = 0.24;
    waypoints[2].hold = 0.3;
    waypoints[4].hold = 0.22;
    waypoints[5].hold = 0.28;
    waypoints[8].hold = 0.16;
    waypoints[10].hold = 0.12;
    waypoints[13].hold = 0.18;

    lastObjectTourDebug = {
      source: "window-product-orbit-25s-cinematic",
      windowCount: selection.windowCount ?? null,
      furnitureCount: selection.furnitureCount ?? null,
      window: summarizeTourItem(windowItem),
      candidateCount: selection.candidateCount,
      score: +selection.score.toFixed(3),
      selected: selection.entries.map((entry) => summarizeTourItem(entry.item, {
        depth: +entry.depth.toFixed(3),
        lateralDistance: +entry.lateralDistance.toFixed(3),
        score: +entry.score.toFixed(3)
      })),
      waypoints: cloneTourWaypoints(waypoints)
    };
    return waypoints;
  }

  function buildFurnitureOnlyInteriorTour(furniture, range = TOUR_LEVEL_RANGE, reason = "no-window-cluster", windowCount = 0) {
    const selected = furniture
      .slice()
      .sort((a, b) => {
        const aw = tourItemWeight(a) * 2 + tourItemFootprint(a);
        const bw = tourItemWeight(b) * 2 + tourItemFootprint(b);
        return bw - aw;
      })
      .slice(0, 5);
    if (!selected.length) {
      lastObjectTourDebug = { source: "static-fallback-empty", reason, windowCount: 0, furnitureCount: 0 };
      return SCENE_TOURS.upperWindowInterior12;
    }

    const center = weightedTourCenter(selected) || selected[0].center.clone();
    let direction = selected[selected.length - 1].center.clone().sub(selected[0].center);
    direction.y = 0;
    if (direction.lengthSq() < 0.0001) direction.set(1, 0, 0);
    direction.normalize();
    const lateral = new THREE.Vector3(-direction.z, 0, direction.x).normalize();
    const cameraHeight = THREE.MathUtils.clamp(center.y + 0.76, range.min + 1.32, range.max - 0.48);
    const entries = selected
      .map((item) => ({
        item,
        depth: item.center.clone().sub(center).dot(direction),
        score: tourItemWeight(item) * 2 + tourItemFootprint(item)
      }))
      .sort((a, b) => a.depth - b.depth || b.score - a.score);
    const waypoints = entries.map((entry, index) => {
      const position = entry.item.center.clone()
        .addScaledVector(direction, -1.05)
        .addScaledVector(lateral, index % 2 === 0 ? 0.18 : -0.18)
        .setY(cameraHeight);
      return makeTourWaypoint(`${entry.item.category} interior`, position, entry.item.center, index === 0 ? 0 : 1.5);
    });
    if (waypoints.length === 1) {
      const only = selected[0];
      waypoints.push(makeTourWaypoint(
        `${only.category} material`,
        only.center.clone().addScaledVector(direction, -0.62).addScaledVector(lateral, 0.45).setY(cameraHeight),
        only.center,
        1.3
      ));
    }

    lastObjectTourDebug = {
      source: "furniture-only",
      reason,
      windowCount,
      furnitureCount: furniture.length,
      selected: entries.map((entry) => summarizeTourItem(entry.item, {
        depth: +entry.depth.toFixed(3),
        score: +entry.score.toFixed(3)
      })),
      waypoints: cloneTourWaypoints(waypoints)
    };
    return waypoints;
  }

  function nearestTourItem(items, category, fromPoint, used = new Set()) {
    return items
      .filter((item) => item.category === category && !used.has(item))
      .sort((a, b) => {
        const af = Math.max(a.size.x, a.size.z);
        const bf = Math.max(b.size.x, b.size.z);
        const ad = fromPoint ? horizontalDistance(a.center, fromPoint) : 0;
        const bd = fromPoint ? horizontalDistance(b.center, fromPoint) : 0;
        return ad - bd || bf - af;
      })[0] || null;
  }

  function buildObjectFocusedInteriorTour(options = {}) {
    const range = options.levelRange || TOUR_LEVEL_RANGE;
    const furniture = collectTourFurniture(range);
    const windows = collectTourWindows(range);
    if (!furniture.length) {
      lastObjectTourDebug = {
        source: "static-fallback-no-furniture",
        windowCount: windows.length,
        furnitureCount: 0,
        waypoints: cloneTourWaypoints(SCENE_TOURS.upperWindowInterior12)
      };
      return SCENE_TOURS.upperWindowInterior12;
    }

    const cluster = chooseTourWindowCluster(windows, furniture);
    if (!cluster) return buildFurnitureOnlyInteriorTour(furniture, range, windows.length ? "windows-without-near-furniture" : "no-windows", windows.length);

    const selection = selectTourItemsForWindow(cluster);
    if (selection) {
      selection.windowCount = windows.length;
      selection.furnitureCount = furniture.length;
    }
    const waypoints = selection ? buildWindowObjectTour(selection, range) : null;
    return waypoints?.length ? waypoints : buildFurnitureOnlyInteriorTour(furniture, range, "selection-empty", windows.length);
  }

  function debugObjectFocusedInteriorTour(options = {}) {
    if (options.useLast && lastObjectTourDebug) {
      return {
        ...lastObjectTourDebug,
        waypoints: cloneTourWaypoints(lastObjectTourDebug.waypoints || [])
      };
    }
    const waypoints = buildObjectFocusedInteriorTour(options);
    return {
      ...(lastObjectTourDebug || {}),
      waypoints: cloneTourWaypoints(waypoints)
    };
  }

  /**
   * Run one of the built-in scene tours or a custom waypoint array.
   * @param {'overview'|'groundFloor'|'upperFloor'|'upperWindowInterior12'|'details'|Array} tourOrName
   * @param {Object} [opts]  — forwarded to CameraTour.autoTour()
   */
  function startTour(tourOrName, opts = {}) {
    const wps = tourOrName === "chuangshaProduct"
      ? buildChuangshaProductTourOneTake(opts)
      : tourOrName === "upperWindowInterior12"
      ? buildObjectFocusedInteriorTour(opts)
      : (typeof tourOrName === 'string' ? SCENE_TOURS[tourOrName] : tourOrName);
    if (!wps) { console.warn(`[renderer] Unknown tour "${tourOrName}"`); return; }
    const isChuangshaTour = tourOrName === "chuangshaProduct" || wps.some((wp) => wp?.tourKind === "chuangshaProduct");
    if (!isChuangshaTour) {
      cameraTour.autoTour(wps, opts);
      return;
    }
    const productTag = opts.tag || wps.find((wp) => wp?.productTag)?.productTag || null;
    const productTourDuration = Number.isFinite(opts.duration) ? opts.duration : 60;
    const userOnProgress = opts.onProgress;
    const userOnComplete = opts.onComplete;
    resetChuangshaProductMotion(productTag);
    cameraTour.autoTour(wps, {
      ...opts,
      duration: productTourDuration,
      onProgress: (state) => {
        setChuangshaProductMotionAtTime(productTag, state.elapsed);
        userOnProgress?.(state);
      },
      onComplete: () => {
        setChuangshaProductMotionAtTime(productTag, productTourDuration);
        userOnComplete?.();
      }
    });
  }

  function stopTour() {
    cameraTour.stop();
    resetChuangshaProductMotion();
  }
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
  function setLocalClarity({ strength, fine, mid, threshold, chroma, limit, radius, white, whiteThreshold, rolloff } = {}) {
    const u = colorGrading.uniforms;
    if (strength != null && u.clarity) u.clarity.value = Math.max(0, Math.min(1.6, strength));
    if (fine != null && u.clarityFine) u.clarityFine.value = Math.max(0, Math.min(1.4, fine));
    if (mid != null && u.clarityMid) u.clarityMid.value = Math.max(0, Math.min(0.8, mid));
    if (threshold != null && u.clarityThreshold) u.clarityThreshold.value = Math.max(0.002, Math.min(0.08, threshold));
    if (chroma != null && u.clarityChroma) u.clarityChroma.value = Math.max(0, Math.min(1, chroma));
    if (limit != null && u.clarityLimit) u.clarityLimit.value = Math.max(0.015, Math.min(0.12, limit));
    if (radius != null && u.sharpenRadius) u.sharpenRadius.value = Math.max(0.35, Math.min(2.5, radius));
    if (white != null && u.whiteEdgeBoost) u.whiteEdgeBoost.value = Math.max(0, Math.min(1.2, white));
    if (whiteThreshold != null && u.whiteEdgeThreshold) u.whiteEdgeThreshold.value = Math.max(0.35, Math.min(0.9, whiteThreshold));
    if (rolloff != null && u.highlightRolloff) u.highlightRolloff.value = Math.max(0.08, Math.min(0.8, rolloff));
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
  const selectedWindowMeshes = new Map();
  let onSelectCallback = null;

  const HIGHLIGHT_COLOR = new THREE.Color(0x00bcd4);
  const WINDOW_SELECTION_COLOR = new THREE.Color(0x3be7ff);
  let _ptrDown = null; // { x, y } screen coords at pointerdown

  function isWindowMesh(obj) {
    return !!obj?.isMesh && TOUR_WINDOW_IFC_TYPES.has(obj.userData.ifcType);
  }

  function readWindowMetaFromMesh(mesh) {
    const data = mesh?.userData || {};
    return {
      name: data.windowName ?? null,
      objectType: data.windowObjectType ?? null,
      tag: data.windowTag ?? null,
      globalId: data.windowGlobalId ?? null,
      overallHeight: data.windowOverallHeight ?? null,
      overallWidth: data.windowOverallWidth ?? null
    };
  }

  function absorbWindowMeta(item, meta) {
    if (!meta) return;
    if (!item.name && meta.name) item.name = meta.name;
    if (!item.objectType && meta.objectType) item.objectType = meta.objectType;
    if (!item.tag && meta.tag) item.tag = meta.tag;
    if (!item.globalId && meta.globalId) item.globalId = meta.globalId;
    if (item.overallHeight == null && meta.overallHeight != null) item.overallHeight = meta.overallHeight;
    if (item.overallWidth == null && meta.overallWidth != null) item.overallWidth = meta.overallWidth;
  }

  function clearWindowSelection() {
    const hadSelectedWindow = !!(selectedMesh && selectedWindowMeshes.has(selectedMesh));
    selectedWindowMeshes.forEach((state, mesh) => {
      if (!mesh) return;
      if (state.material) mesh.material = state.material;
    });
    selectedWindowMeshes.clear();
    if (hadSelectedWindow) {
      selectedMesh = null;
      selectedOriginalEmissive = null;
      if (onSelectCallback) onSelectCallback(null);
    }
    markDirty();
  }

  function collectWindowInventory() {
    const byKey = new Map();
    root.traverse((obj) => {
      if (!isWindowMesh(obj) || obj.userData._windowReplacementHidden) return;
      const box = new THREE.Box3().setFromObject(obj);
      if (!finiteBox(box)) return;
      const key = obj.userData.expressID != null ? String(obj.userData.expressID) : obj.uuid;
      let item = byKey.get(key);
      if (!item) {
        item = {
          key,
          expressID: obj.userData.expressID ?? null,
          ifcType: obj.userData.ifcType,
          name: null,
          objectType: null,
          tag: null,
          globalId: null,
          overallHeight: null,
          overallWidth: null,
          meshes: [],
          box: new THREE.Box3()
        };
        byKey.set(key, item);
      }
      absorbWindowMeta(item, readWindowMetaFromMesh(obj));
      item.meshes.push(obj);
      item.box.union(box);
    });

    return Array.from(byKey.values())
      .map((item) => {
        const center = item.box.getCenter(new THREE.Vector3());
        const size = item.box.getSize(new THREE.Vector3());
        return {
          ...item,
          center,
          size,
          levelHint: center.y < 3.1 ? "L1" : center.y < 6.1 ? "L2" : "Roof"
        };
      })
      .sort((a, b) => {
        if (a.levelHint !== b.levelHint) return a.center.y - b.center.y;
        return a.center.x - b.center.x || a.center.z - b.center.z || String(a.key).localeCompare(String(b.key));
      })
      .map((item, index) => ({
        id: `W${String(index + 1).padStart(2, "0")}`,
        expressID: item.expressID,
        ifcType: item.ifcType,
        name: item.name,
        objectType: item.objectType,
        tag: item.tag,
        globalId: item.globalId,
        overallHeight: item.overallHeight,
        overallWidth: item.overallWidth,
        levelHint: item.levelHint,
        meshCount: item.meshes.length,
        center: item.center.toArray().map((n) => +n.toFixed(3)),
        size: item.size.toArray().map((n) => +n.toFixed(3)),
        box: boxSnapshot(item.box),
        meshes: item.meshes
      }));
  }

  function getWindowInventory() {
    return collectWindowInventory().map(({ meshes, ...item }) => item);
  }

  function selectAllWindows() {
    clearSelection();
    clearWindowSelection();
    const windows = collectWindowInventory();
    windows.forEach((item) => {
      item.meshes.forEach((mesh) => {
        if (selectedWindowMeshes.has(mesh)) return;
        selectedWindowMeshes.set(mesh, { material: mesh.material });
        const mat = mesh.material?.clone ? mesh.material.clone() : mesh.material;
        if (mat) {
          if (mat.emissive) mat.emissive.copy(WINDOW_SELECTION_COLOR);
          if ("emissiveIntensity" in mat) mat.emissiveIntensity = 0.72;
          if ("opacity" in mat && mat.transparent) mat.opacity = Math.max(mat.opacity ?? 0.45, 0.58);
          mesh.material = mat;
        }
      });
    });
    markDirty();
    return {
      count: windows.length,
      meshCount: windows.reduce((sum, item) => sum + item.meshes.length, 0),
      windows: windows.map(({ meshes, ...item }) => item)
    };
  }

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
    tourStudioPointerDown = { x: event.clientX, y: event.clientY };
  }
  function onPointerUp(event) {
    if (tourStudioDragging || tourStudioSuppressNextPick) {
      _ptrDown = null;
      tourStudioPointerDown = null;
      return;
    }
    if (!_ptrDown) return;
    const dx = event.clientX - _ptrDown.x;
    const dy = event.clientY - _ptrDown.y;
    _ptrDown = null;
    tourStudioPointerDown = null;
    if (dx * dx + dy * dy > 25) return; // moved > 5px — orbit drag, skip
    if (pickTourStudioNode(event)) return;

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
          windowName: hit.object.userData.windowName || null,
          windowObjectType: hit.object.userData.windowObjectType || null,
          windowTag: hit.object.userData.windowTag || null,
          windowGlobalId: hit.object.userData.windowGlobalId || null,
          windowOverallHeight: hit.object.userData.windowOverallHeight || null,
          windowOverallWidth: hit.object.userData.windowOverallWidth || null,
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
    const dayBg = new THREE.Color(0xf8f7f2);
    const nightBg = new THREE.Color(0x1a2030);
    scene.background = dayBg.clone().lerp(nightBg, dayNightMix);
    // Fog color follows background
    scene.fog.color.copy(scene.background);
    // Hemisphere light: bright sky → dim warm
    hemi.intensity = THREE.MathUtils.lerp(0.76, 0.25, dayNightMix);
    hemi.color.set(dayNightMix < 0.5 ? 0xeaf2ff : 0xffe8c0);
    // Ambient: brighter at night to simulate indoor lights
    ambient.intensity = THREE.MathUtils.lerp(0.18, 0.28, dayNightMix);
    ambient.color.set(dayNightMix > 0.5 ? 0xffeedd : 0xffffff);
    // Sun intensity drops at night
    sunLight.intensity = THREE.MathUtils.lerp(2.28, 0.25, dayNightMix);
    // Fill light warms up at night
    fill.intensity = THREE.MathUtils.lerp(0.82, 0.36, dayNightMix);
    fill.color.set(dayNightMix > 0.5 ? 0xffe0b0 : 0xb8d4ee);
    // Exposure slight bump at night for indoor visibility
    renderer.toneMappingExposure = THREE.MathUtils.lerp(0.9, 0.98, dayNightMix);
    markDirty();
  }

  /**
   * Apply a style preset to all materials in the scene.
   * @param {'japandi'|'luxury'|'volcanic'|'smart'} styleName
   */
  function setStyle(styleName, options = {}) {
    const newMats = matFactory.apply(styleName, options);
    disposeReplacementMaterials(replacementMaterialSet);
    replacementMaterialSet = null;
    replacementMaterialStyle = null;
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
    replacementGroups.forEach((group) => {
      applyReplacementMaterialsToGroup(group, group.userData.replacementCategory);
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
    setLocalClarity,
    setSSR,
    setStyle,
    getActiveStyle:       () => matFactory.activeStyle,
    setLightPreset,
    getActiveLightPreset: () => lightFactory.activePreset,
    loadGlb,
    removeGlb,
    replaceSemanticFurnitureFromGlb,
    clearSemanticFurnitureReplacements,
    replaceWindowsByTagsFromGlb,
    clearWindowReplacements,
    startTour,
    stopTour,
    isTourRunning: () => cameraTour.isRunning,
    buildObjectFocusedInteriorTour: (options = {}) => cloneTourWaypoints(buildObjectFocusedInteriorTour(options)),
    buildChuangshaProductTour: (options = {}) => cloneTourWaypoints(buildChuangshaProductTourOneTake(options)),
    getSceneTour: (name = "overview") => (SCENE_TOURS[name] || []).map((wp) => ({
      ...wp,
      position: wp.position?.slice(),
      target: wp.target?.slice()
    })),
    loadHdri: (url) => _applyHdriUrl(url),
    setSystemVisibility,
    setLevelFilter,
    getKnownSystems,
    debugVisibilityStats,
    debugFurnitureMaterialAssignments,
    debugFurnitureMaterialLooks,
    debugFurnitureGeometryStats,
    debugFurnitureMaterialStateStats,
    debugFurnitureReplacementCandidates,
    debugFurnitureReplacementMaterialLooks,
    debugWindowReplacementTargets,
    debugChuangshaProductTour,
    debugChuangshaScreenInstallation,
    debugChuangshaMotionState,
    debugObjectFocusedInteriorTour,
    getWindowInventory,
    selectAllWindows,
    clearWindowSelection,
    debugGroupBboxes,
    setPostProcessing,
    setSunPosition,
    setTimeOfDay,
    flyToInterior,
    getCameraPose,
    setCameraPose,
    showTourStudioOverlay,
    clearTourStudioOverlay,
    setTourStudioOverlayVisible,
    setTourStudioSelection,
    previewTourStudioAt,
    setTourStudioNodeChangeHandler,
    setTourStudioNodeSelectHandler,
    diagnoseTourStudioWaypoints,
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
      try { clearTourStudioOverlay(); } catch {}
      try { disposeReplacementMaterials(); } catch {}
      try { disposeChuangshaMaterialSet(); } catch {}
      replacementTextureCache.forEach((tex) => {
        try { tex.dispose(); } catch {}
      });
      replacementTextureCache.clear();
      try { dracoLoader.dispose(); } catch {}
      composer.dispose();
      renderer.dispose();
      pmrem.dispose();
    }
  };
}
