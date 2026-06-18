# Web3D 真实家装渲染技术 Skills 分享

> 提炼自 5 个开源项目，对标酷家乐/三维家的 Web 端实时渲染效果。
> 核心思路：**Baked + Real-time 混合 → PBR 材质 → 后期校色** 三层渲染架构。

---

## 一、项目来源与定位

| 项目 | 技术栈 | 亮点 | 适用场景 |
|------|--------|------|----------|
| [SreeXD/Srees-Room](https://srees-room.vercel.app) | R3F + drei + GLSL | 烘焙贴图 + 昼夜 Shader 过渡 | 风格化室内 |
| [houssemlachtar/My-3D-Room](https://my-3-d-room.vercel.app) | Three.js + FPC | 程序化建模 + 第一人称漫游 | 快速原型 |
| [iivvaannxx/my-room](https://my-room.pages.dev) | TS + Three.js | Bruno Simon 比赛作品，等轴测交互 | 产品展示 |
| [z2586300277/examples](https://z2586300277.github.io/three-cesium-examples) | 原生 Three.js (380+案例) | 地板反射、延迟光照、辉光 | 工程化参考 |
| SreeXD/Three-PT | WebGPU Path Tracer | 物理正确路径追踪 | 离线品质预览 |

---

## 二、核心渲染技术栈（由浅入深）

### 2.1 烘焙光照 + 实时补光（性价比最高）

**原理**：Blender Cycles 离线渲染 → 展 UV → 烘焙 Lightmap → Three.js 叠加实时灯

**Srees-Room 的做法**：
```glsl
// room.frag — 昼夜切换 Shader
uniform float uDayTimeMix;
uniform sampler2D uTextureMorning;
uniform sampler2D uTextureNight;

void main() {
  vec3 morning = texture2D(uTextureMorning, vUv).rgb;
  vec3 night   = texture2D(uTextureNight, vUv).rgb;
  gl_FragColor = vec4(mix(morning, night, uDayTimeMix), 1.0);
}
```

**适用于酷家乐场景**：
- 户型方案确定后一次性烘焙 → 浏览时 0 开销的 GI
- 加 2-3 盏实时 PointLight 模拟可交互灯具开关
- 用 `uDayTimeMix` 做时间轴："清晨阳光 → 夜间暖光" 氛围切换

---

### 2.2 PBR 材质系统

**关键参数组合**（从我们 bp3d-materials.js 和行业实践）：

| 材质 | roughness | metalness | 特殊处理 |
|------|-----------|-----------|----------|
| 木地板 | 0.45-0.55 | 0.04 | clearcoat 0.28 + anisotropy 0.5 |
| 大理石 | 0.1-0.2 | 0.02 | clearcoat 0.85 + 法线贴图 |
| 乳胶墙漆 | 0.85-0.92 | 0 | 细微 fbm 纹理模拟辊印 |
| 不锈钢 | 0.25-0.35 | 0.92 | roughnessMap 拉丝方向 |
| 布艺沙发 | 0.7-0.85 | 0 | sheen 0.4 + sheenRoughness 0.7 |
| 玻璃 | 0.05 | 0 | transmission 1.0 + ior 1.52 |
| 瓷砖 | 0.08-0.15 | 0.02 | clearcoat 0.9 + 环境反射 |

---

### 2.3 地板镜面反射（Planar Reflector）

**three-cesium-examples `modelBlendReflector` 技术**：

核心思路：对地板平面做 "virtual camera" 镜像渲染，输出到 RT 纹理叠加。

```javascript
// 简化版：给任意地板 mesh 添加反射
function addFloorReflection(mesh, scene, camera) {
  const reflectorCamera = new THREE.PerspectiveCamera();
  const renderTarget = new THREE.WebGLRenderTarget(512, 512, {
    samples: 4, type: THREE.HalfFloatType
  });
  // 计算反射矩阵 → 渲染到 RT → 叠加到 mesh.material
  mesh.material.onBeforeCompile = (shader) => {
    shader.uniforms.refDiffuse = { value: renderTarget.texture };
    // 注入 fragment: gl_FragColor.rgb += texture2DProj(refDiffuse, refUv).rgb * 0.3;
  };
}
```

**酷家乐效果**：瓷砖/大理石地面的湿润光泽感 — 非常出效果的技巧。

---

### 2.4 后期处理流水线

**推荐组合**（参考 three-cesium-examples + 我们的实践）：

```
RenderPass → SelectiveBloom → SSAO → ToneMapping → SMAA → Output
```

| Pass | 作用 | 参数建议 |
|------|------|----------|
| **Selective Bloom** | 只让灯具/高光区域发光 | threshold 0.9, strength 0.3 |
| **N8AO / GTAO** | 缝隙暗角，空间感 | radius 0.5m, intensity 1.5 |
| **ACES Tone Mapping** | 电影感色彩压缩 | exposure 1.0-1.3 |
| **SMAA** | 抗锯齿（比 MSAA 轻） | 默认 |
| **Vignette** | 暗角聚焦 | offset 1.0, darkness 0.8 |

---

### 2.5 第一人称漫游（FPS 看房）

**houssemlachtar 的简版 + 碰撞检测升级**：


```javascript
// PointerLockControls + Octree 碰撞（three-cesium-examples 方案）
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Octree } from 'three/addons/math/Octree.js';

const octree = new Octree();
octree.fromGraphNode(roomModel); // 从房屋模型构建八叉树

const playerVelocity = new THREE.Vector3();
const GRAVITY = 9.8;

function updatePlayer(delta) {
  playerVelocity.y -= GRAVITY * delta;
  const result = octree.capsuleIntersect(playerCollider);
  if (result) {
    playerVelocity.y = 0;
    playerCollider.translate(result.normal.multiplyScalar(result.depth));
  }
  camera.position.copy(playerCollider.end);
}
```

**酷家乐对标**：VR 看房模式 — 点击热点切换位置 + 平滑过渡动画。

---

### 2.6 环境光探针 / IBL

```javascript
const pmrem = new THREE.PMREMGenerator(renderer);
// 方案 A：从 Sky 生成（纯程序化，0 资源）
const envMap = pmrem.fromScene(skyScene, 0.04).texture;
// 方案 B：从 HDR 加载（更真实）
new RGBELoader().load('interior.hdr', (texture) => {
  scene.environment = pmrem.fromEquirectangular(texture).texture;
});
```

**室内特化**：用多个 Light Probe 分区域采样，避免单一 IBL 在复杂户型中光照不一致。

---

### 2.7 高斯溅射 / 3D Gaussian Splatting

- 手机扫描真实房间 → 训练 GS 模型 → Web 端实时渲染
- 比全景照片多了 **6DOF 自由视角**
- 库推荐：antimatter15/splat、LumaAI、SuperSplat

---

## 三、架构设计建议（对标酷家乐）

```
┌─────────────────────────────────────────────────┐
│                   编辑器层                        │
│  户型绘制 → 家具拖放 → 材质替换 → 灯光布置       │
└────────────────────────┬────────────────────────┘
                         │ JSON 方案数据
┌────────────────────────▼────────────────────────┐
│                   渲染引擎                        │
│  IFC/GLTF 加载 │ PBR 材质系统 │ 后期处理管线    │
│  Baked GI      │ 实时灯光     │ Reflector 反射  │
└────────────────────────┬────────────────────────┘
                         │ WebGL / WebGPU
┌────────────────────────▼────────────────────────┐
│                   交互层                          │
│  轨道浏览 │ FPS 漫游 │ VR 看房 │ 截图导出        │
└─────────────────────────────────────────────────┘
```

---

## 四、Quick Wins（快速出效果 5 件事）

| # | 技术 | 投入 | 效果提升 |
|---|------|------|----------|
| 1 | **HDR 环境贴图** | 5min | 金属/玻璃立刻"活"起来 |
| 2 | **Contact Shadow** | 30min | 家具落地感 +200% |
| 3 | **地板 Reflector** | 1h | 瓷砖/大理石湿润质感 |
| 4 | **Selective Bloom** | 30min | 灯具发光，氛围感拉满 |
| 5 | **ACES Tone Mapping** | 1min | 色彩从"CG味"变"照片味" |

---

## 五、推荐学习路径

1. **入门**：跑通 three-cesium-examples 的 `houseScene` → 理解场景搭建
2. **材质**：用 Srees-Room 的 baked texture 方案做一个自己的房间
3. **进阶**：加 Reflector + Bloom + SSAO 后期管线
4. **工程化**：参考 `bp3d-real-renderer.js` — Worker 加载 + 流式渲染
5. **前沿**：尝试 3D Gaussian Splatting 做实景看房

---

## 六、参考资源

- 📖 [380+ Three.js 案例讲解](https://z2586300277.github.io/examples/)
- 🎮 [Srees-Room Demo](https://srees-room.vercel.app) — 昼夜切换 + 交互
- 🏠 [My-3D-Room Demo](https://my-3-d-room.vercel.app) — 第一人称漫游
- 🔬 [Three-PT Path Tracer](https://github.com/SreeXD/Three-PT) — WebGPU 离线品质
- 📐 [Bruno Simon Three.js Journey](https://threejs-journey.com)
- 🛋️ [Sketchfab 家具模型](https://sketchfab.com/search?q=furniture&type=models)
