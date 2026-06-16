# Blueprint3D 真实感渲染 SOP

> 维护：3DInvestigation · `blueprint3d-duplex.html`
> 更新：2026-06-17

## 1. 当前架构

```
HTML (blueprint3d-duplex.html)
├── xeokit 主视图        : XKT 工程模型 + 语义层 (默认)
└── PBR · IFC 切换层     : web-ifc + Three.js 0.165 高级渲染 (按钮触发)
    ├── scripts/bp3d-real-renderer.js   渲染管线 + IFC 加载
    └── scripts/bp3d-materials.js       程序化 PBR 纹理 + 材质映射
```

数据来源：`samples/duplex-apartment/raw/*.ifc`（5 个原始 IFC，共约 60 MB）。

## 2. Level 体系（已做 / 待做）

| Level | 内容 | 状态 |
|---|---|---|
| L1 调参美化 | ACES Filmic、曝光 1.18、VSM 软阴影、对比度 | ✅ |
| L2 HDR + 后处理 | Sky shader 程序化天空 → PMREM IBL；EffectComposer (Render→SAO→Bloom→SMAA→Output) | ✅ HDR 用程序化 Sky 替代真 HDR 文件 |
| L3 PBR 纹理 | Canvas 2D 程序化木地板（diffuse + normal）、石膏墙、磨砂金属 roughness | ✅ |
| L4 家具 + 体积光 | 程序化家具自动布置、体积光、God Rays | ⏳ 未做 |

降级说明：
- 网络白名单允许 GitHub raw，但实际不可达，外部 HDR / 纹理 / GLB 全部下载失败
- 转用 100% 程序化方案（Canvas2D 纹理 + Sky shader）保证零网络依赖

## 3. 改进路线图（按优先级）

### P0 资产升级（最大视觉提升）

- **真 HDR 环境贴图**：Polyhaven `studio_small_03_2k.hdr` 或同类（需网络打通或离线包入仓）
- **真 PBR 纹理包**：木地板 / 瓷砖 / 大理石 / 石膏的 4K diffuse + normal + roughness + AO
- **真家具 GLB**：CC0 沙发 / 床 / 桌椅 / 灶台 / 卫浴
- 入仓策略：`assets/hdr/`、`assets/textures/`、`assets/furniture/`，加 LFS 或单独资产仓

### P1 性能与稳定

- **IFC 分批加载**：Plumbing 30 MB 单文件解析卡 5–8s，应放 Worker 异步
- **Instancing**：重复构件（管道、灯具）用 `InstancedMesh` 合并
- **LOD**：远距用 BoxGeometry 替代精细网格
- **几何缓存**：同一 `geometryExpressID` 的 `BufferGeometry` 共享，不重复构建
- **错误隔离**：每个 IFC 文件独立 try/catch（已有），加重试与超时

### P2 视觉细节

- **SSR 屏幕空间反射**：地板镜面感（自定义 Pass）
- **接触阴影**：Contact Shadows，弥补硬阴影边缘
- **TAA 抗锯齿**：替代 SMAA，运动模糊感更佳
- **DOF 景深**：聚焦相机目标
- **体积光 / God Rays**：从窗户洒进的阳光体积感
- **动态日照**：与 xeokit 主视图的时间轴联动，太阳位置随时间移动

### P3 交互

- **构件选中高亮**：raycaster + 描边 Pass
- **属性面板**：点击构件读 `ifcApi.GetLine(modelID, expressID)` 显示 IFC 属性
- **楼层切换**：用 viewer-payload `canonicalLevels` 过滤几何 visible
- **MEP 系统过滤**：按 IfcDistributionSystem 显隐
- **测量工具**：两点距离、角度
- **截图导出**：`renderer.domElement.toBlob` PNG / WebP

### P4 数据贯通

- **房间标签**：在 PBR 视图里浮动 viewer-payload `canonicalSpaces` 的 longName
- **MEP 系统着色**：按 `objectIndex.bucket` (`hvac_air` / `plumbing_*` / `electrical_*`) 分色
- **属性同步**：xeokit 选中 ↔ PBR 视图相机飞向（要求建立 IFC GUID ↔ XKT object id 映射表）

### P5 工程规范

- **冒烟测试**：playwright 启动 dev server，加载页面，点 PBR 按钮，断言 5 秒内出现 mesh
- **CI 截图比对**：每次 commit 后生成 PBR 截图并和基线对比，差异 > 阈值告警
- **依赖审计**：`npm audit` 当前有 4 个漏洞（2 moderate, 2 high），定期清理
- **资产体积监控**：`du -sh assets/` 阈值 50 MB，超出告警
- **运行时错误监控**：Sentry / Bugsnag 或本地 console.error → fetch 上报

### P6 部署生产化

- **wasm 路径**：`SetWasmPath("./node_modules/web-ifc/")` 改为相对部署根的可配置路径
- **gzip / brotli**：服务器开启，IFC 60 MB 压缩后约 15–20 MB
- **预转换缓存**：构建时 IFC → 优化 GLB（IfcConvert 离线），生产环境用 GLB 加载
- **CDN**：HDR / 纹理 / 家具放公司 CDN 白名单

## 4. 关键决策记录

| 决策 | 原因 |
|---|---|
| 选 `web-ifc` 而非 `web-ifc-three` | 后者 peer three@^0.149，与本项目 three@0.165 冲突 |
| 不用 npm 上的 `blueprint3d` 包 | 锁定 Three r69 + jQuery 2 + Bootstrap 3，与 ESM 现代栈不兼容 |
| 程序化 Sky 替代下载 HDR | GitHub raw 网络不可达；Sky shader + PMREM 效果可接受 |
| 程序化 Canvas2D 纹理 | 同上，且方便迭代调色 |
| 切换按钮而非替换主视图 | 失败时 xeokit 主视图保持可用，零回归风险 |
| 不强行 `--legacy-peer-deps` | API 不兼容会运行时崩，不如选底层 web-ifc 自己写 mesh |

## 5. 立即可做的下一步（按 ROI 排序）

1. **HDR 资产入仓** —— 找一台能上 Polyhaven 的机器下载 1–3 张 1k HDR，放 `assets/hdr/`，改 renderer 用 RGBELoader 加载（替代 Sky）。**视觉提升 70%**，工作量 1 小时。
2. **构件选中高亮** —— `raycaster` + `OutlinePass`。让 PBR 视图也能交互，工作量 半天。
3. **房间浮动标签** —— 用 `viewer-payload.canonicalSpaces.locations` 在 PBR 视图叠加 HTML 标签。工作量 半天。
4. **InstancedMesh 优化** —— Plumbing 30 MB 后大量重复管段，Instancing 后帧率从 20 → 60。工作量 1 天。
5. **真家具 GLB** —— 等资产入仓后，按房间类型自动布置。工作量 1–2 天。

## 6. 已知风险

- `web-ifc` 当前 4 个 npm audit 漏洞（来自 transitive deps），需评估
- IFC 60 MB 首次加载 5–15s，移动端可能更慢
- VSMShadowMap 在某些低端 GPU 兼容性差，需做特性检测降级 PCFSoft
- web-ifc wasm 在某些浏览器（旧 Safari）需要 `SharedArrayBuffer` 跨域隔离头
- `transmission` 玻璃材质开销大，玻璃过多会卡顿，需控制数量

## 7. 文件清单

| 文件 | 角色 |
|---|---|
| `blueprint3d-duplex.html` | 主页面 + 切换按钮 + import map |
| `scripts/bp3d-real-renderer.js` | 渲染管线（场景、相机、灯光、Sky、后处理、IFC 加载流程） |
| `scripts/bp3d-materials.js` | 程序化 PBR 纹理 + IFC 类型 → 材质映射表 |
| `node_modules/web-ifc/` | wasm IFC 解析器 |
| `node_modules/three/` | Three.js 0.165（含 examples/jsm 全套 addons） |
| `samples/duplex-apartment/raw/*.ifc` | 5 个原始 IFC 数据源 |
