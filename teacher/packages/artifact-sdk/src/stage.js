import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createErrorOverlay, createTeacherToolbar } from './ui.js';
import { TEACHER_UI } from './constants.js';

/**
 * 创建一个标准 Three.js 教学舞台。
 *
 * 默认包含：
 * - WebGLRenderer（antialias）
 * - PerspectiveCamera
 * - OrbitControls（可拖动视角，支持触摸）
 * - 三盏基础灯光（ambient + directional + fill）
 * - resize 处理
 * - requestAnimationFrame 动画循环
 * - 教师工具栏（全屏、重置）
 * - onReset 回调（默认恢复 camera 与 controls 到初始状态）
 *
 * @param {object} options
 * @returns {{renderer, scene, camera, controls, mount, start, stop, dispose, onReset, toolbar}}
 */
export function createStage(options = {}) {
  const {
    mount = document.body,
    fov = 50,
    cameraPosition = [3, 2, 5],
    cameraLookAt = [0, 0, 0],
    clearColor = TEACHER_UI.BACKGROUND,
    controls = true,
    animate = true,
    toolbar = true,
    onReset
  } = options;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(clearColor);

  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 1000);
  camera.position.set(...cameraPosition);
  camera.lookAt(...cameraLookAt);

  const container = typeof mount === 'string' ? document.querySelector(mount) : mount;
  if (!container) {
    throw new Error('[artifact-sdk] createStage: mount element not found');
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (cause) {
    // A missing WebGL context must never produce a blank screen in a classroom.
    const overlay = createErrorOverlay({
      title: '无法启动 3D 显示',
      detail:
        '当前环境没有可用的 WebGL。请尝试：更新显卡驱动、在浏览器设置中开启硬件加速，'
        + `或改用其他浏览器/设备打开该教具。（技术信息：${cause && cause.message ? cause.message : cause}）`,
      container
    });
    return {
      renderer: null,
      scene,
      camera,
      controls: null,
      lights: {},
      clock: new THREE.Clock(),
      container,
      mount: container,
      failed: true,
      error: cause,
      errorOverlay: overlay,
      start() {},
      stop() {},
      resize() {},
      reset() {},
      onReset() {},
      onUpdate() {},
      dispose() { overlay.hide(); }
    };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  container.style.position = container.style.position || 'relative';
  container.style.width = '100%';
  container.style.height = '100vh';
  container.style.overflow = 'hidden';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);

  let orbit = null;
  if (controls) {
    orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.minDistance = 0.5;
    orbit.maxDistance = 80;
    orbit.target.set(...cameraLookAt);
    orbit.touches.ONE = THREE.TOUCH.ROTATE;
    orbit.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  }

  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(5, 8, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9db6ff, 0.7);
  fill.position.set(-4, 2, -3);
  scene.add(fill);
  const lights = { ambient, key, fill };

  const initialState = {
    cameraPosition: [...cameraPosition],
    cameraLookAt: [...cameraLookAt]
  };

  function reset() {
    camera.position.set(...initialState.cameraPosition);
    camera.lookAt(...initialState.cameraLookAt);
    if (orbit) {
      orbit.target.set(...initialState.cameraLookAt);
      orbit.update();
    }
    if (onReset) onReset();
  }

  let tb = null;
  if (toolbar) {
    tb = createTeacherToolbar({ container, onReset: reset });
  }

  let frameId = 0;
  let running = false;
  const updateFns = [];

  function tick() {
    frameId = requestAnimationFrame(tick);
    if (orbit) orbit.update();
    for (const fn of updateFns) fn(clock.getElapsed(), clock.getDelta());
    renderer.render(scene, camera);
  }

  const clock = new THREE.Clock();
  function start() {
    if (!running) {
      running = true;
      tick();
    }
  }
  function stop() {
    running = false;
    cancelAnimationFrame(frameId);
  }

  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  resize();
  window.addEventListener('resize', resize);

  if (animate) start();

  return {
    renderer,
    scene,
    camera,
    controls: orbit,
    lights,
    clock,
    container,
    mount: container,
    start,
    stop,
    resize,
    reset,
    onReset: reset,
    onUpdate(fn) { updateFns.push(fn); },
    dispose() {
      stop();
      window.removeEventListener('resize', resize);
      if (orbit) orbit.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      if (tb) tb.destroy();
    }
  };
}

export const createStage3D = createStage;

export function disposeStage(stage) {
  if (stage && typeof stage.dispose === 'function') stage.dispose();
}