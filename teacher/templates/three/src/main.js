import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import './style.css';
import {
  createStage,
  createTeachingApp,
  createSlider,
  createToggle,
  createReadout,
  createInfoCard
} from '@teacher-dsh/artifact-sdk';

/**
 * 完整 Three.js 教学模板：三维太阳系。
 *
 * 这个模板已经预配好课堂上需要的一切：
 * - createTeachingApp 应用外壳（标题区 + 舞台 + 右侧控制面板 + 工具栏）
 * - Scene / PerspectiveCamera / WebGLRenderer / OrbitControls
 * - resize 处理、requestAnimationFrame 动画循环、时钟
 * - 环境光 + 主平行光 + 补光 + 太阳点光源
 * - 网格与坐标辅助线（可切换）
 * - CSS2DRenderer 中文标签
 * - 加载指示器 / WebGL 失败中文提示 / 全屏 / 重置
 *
 * 可直接使用的 Three.js addons（SDK 已随包提供 three 0.186.0）：
 *   three/addons/controls/OrbitControls.js
 *   three/addons/controls/TransformControls.js
 *   three/addons/loaders/GLTFLoader.js
 *   three/addons/loaders/OBJLoader.js
 *   three/addons/loaders/FontLoader.js
 *   three/addons/renderers/CSS2DRenderer.js
 *   three/addons/lines/Line2.js
 */

const app = createTeachingApp({
  mount: '#app',
  title: '三维太阳系',
  subtitle: '拖动旋转视角 · 滚轮缩放 · 双击空白重置'
});

const stage = createStage({
  mount: app.stage,
  cameraPosition: [0, 6, 14],
  cameraLookAt: [0, 0, 0],
  clearColor: 0x05070f,
  onReset: () => app.setLoadingText('视图已重置')
});
app.hideLoading();

const { scene, camera } = stage;

// 中文标签渲染器（CSS2D）
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(app.stage.clientWidth, app.stage.clientHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
app.stage.appendChild(labelRenderer.domElement);
window.addEventListener('resize', () => {
  labelRenderer.setSize(app.stage.clientWidth, app.stage.clientHeight);
});

// 辅助：网格 + 坐标轴，方便讲解空间方位
const grid = new THREE.GridHelper(40, 40, 0x1e3a5f, 0x122033);
grid.position.y = -0.6;
scene.add(grid);
const axes = new THREE.AxesHelper(6);
axes.position.y = -0.6;
axes.visible = false;
scene.add(axes);

// 太阳
const sun = new THREE.Mesh(
  new THREE.SphereGeometry(1.4, 64, 64),
  new THREE.MeshStandardMaterial({ color: 0xffb703, emissive: 0xff7b00, emissiveIntensity: 1.4 })
);
sun.userData.name = '太阳';
scene.add(sun);
const sunLight = new THREE.PointLight(0xffd9a0, 900, 200, 2);
scene.add(sunLight);
addLabel(sun, '太阳');

// 行星
const PLANETS = [
  { name: '水星', radius: 0.16, distance: 2.6, period: 0.24, color: 0x9ca3af },
  { name: '金星', radius: 0.26, distance: 3.6, period: 0.62, color: 0xfbbf24 },
  { name: '地球', radius: 0.28, distance: 4.8, period: 1.0, color: 0x3b82f6, moon: true },
  { name: '火星', radius: 0.2, distance: 6.0, period: 1.88, color: 0xef4444 },
  { name: '木星', radius: 0.62, distance: 8.0, period: 11.86, color: 0xd97706 }
];

const orbitGroup = new THREE.Group();
scene.add(orbitGroup);
const planetNodes = [];

for (const planet of PLANETS) {
  const pivot = new THREE.Object3D();
  pivot.rotation.y = Math.random() * Math.PI * 2;
  orbitGroup.add(pivot);

  const orbit = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(circlePoints(planet.distance, 160)),
    new THREE.LineBasicMaterial({ color: 0x27405f, transparent: true, opacity: 0.85 })
  );
  pivot.add(orbit);

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(planet.radius, 48, 48),
    new THREE.MeshStandardMaterial({ color: planet.color, roughness: 0.85, metalness: 0.05 })
  );
  mesh.position.x = planet.distance;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.name = planet.name;
  pivot.add(mesh);
  addLabel(mesh, planet.name);

  let moon = null;
  if (planet.moon) {
    const moonPivot = new THREE.Object3D();
    mesh.add(moonPivot);
    moon = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0xe5e7eb })
    );
    moon.position.x = 0.52;
    moonPivot.add(moon);
  }

  planetNodes.push({ planet, pivot, mesh, moon, angle: 0 });
}

const labels = [];
function addLabel(object, text) {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.color = '#e2e8f0';
  el.style.fontSize = '14px';
  el.style.fontFamily = '"Microsoft YaHei", "PingFang SC", sans-serif';
  el.style.textShadow = '0 1px 3px #000';
  el.style.padding = '0 2px';
  const label = new CSS2DObject(el);
  label.position.set(0, 0.34, 0);
  object.add(label);
  labels.push(label);
}

function circlePoints(radius, segments) {
  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  return points;
}

// ---------------- 控制面板 ----------------
let speed = 1;
let paused = false;

const panel = app.createPanel({ title: '控制面板' });

const speedReadout = createReadout({ label: '当前倍速', value: '1.0×', container: panel.body });

panel.add(createSlider({
  label: '公转速度',
  min: 0,
  max: 4,
  step: 0.1,
  value: 1,
  onChange: (v) => { speed = v; speedReadout.setText(v.toFixed(1) + '×'); },
  container: panel.body
}).el);

panel.add(createToggle({
  label: '显示轨道线',
  value: true,
  onChange: (v) => { orbitGroup.children.forEach((pivot) => { pivot.children[0].visible = v; }); },
  container: panel.body
}).el);

panel.add(createToggle({
  label: '显示名称标签',
  value: true,
  onChange: (v) => { labels.forEach((label) => { label.visible = v; }); },
  container: panel.body
}).el);

panel.add(createToggle({
  label: '显示网格与坐标轴',
  value: false,
  onChange: (v) => { grid.visible = v; axes.visible = v; },
  container: panel.body
}).el);

const pauseToggle = createToggle({
  label: '暂停动画',
  value: false,
  onChange: (v) => { paused = v; },
  container: panel.body
});
panel.add(pauseToggle.el);

const card = createInfoCard({
  title: '太阳系',
  text: '点击行星查看名称与轨道半径。',
  container: app.stage
});

// ---------------- 交互 ----------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const canvas = stage.renderer.domElement;

canvas.addEventListener('pointerdown', (event) => {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(planetNodes.map((n) => n.mesh).concat(sun), false);
  if (hits.length > 0) {
    const target = hits[0].object;
    const node = planetNodes.find((n) => n.mesh === target);
    card.setText(node
      ? `${node.planet.name}：轨道半径 ${node.planet.distance.toFixed(1)}，公转周期约 ${(node.planet.period * 365).toFixed(0)} 天`
      : '太阳：太阳系的中心天体，占系统总质量的约 99.86%。');
  }
});

canvas.addEventListener('dblclick', () => stage.reset());

// ---------------- 动画 ----------------
const BASE_SPEED = 0.25;
const elapsed = { value: 0 };
stage.onUpdate((_clockElapsed, delta) => {
  if (paused) return;
  const step = Math.min(delta, 0.05) * speed;
  elapsed.value += step;
  for (const node of planetNodes) {
    node.pivot.rotation.y += step * BASE_SPEED / node.planet.period;
    node.mesh.rotation.y += step * 0.6;
    if (node.moon) node.moon.parent.rotation.y += step * 2.4;
  }
  sun.rotation.y += step * 0.12;
  labelRenderer.render(scene, camera);
});

window.addEventListener('beforeunload', () => {
  labelRenderer.domElement.remove();
  stage.dispose();
  app.dispose();
});
