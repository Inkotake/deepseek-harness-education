import * as THREE from 'three';
import { createStage, createInfoCard } from '@teacher-dsh/artifact-sdk';

const stage = createStage({
  mount: '#stage',
  cameraPosition: [0, 3, 8],
  cameraLookAt: [0, 0, 0],
  clearColor: 0x0a0a1a
});

const { scene } = stage;

// 太阳
const sun = new THREE.Mesh(
  new THREE.SphereGeometry(1.2, 64, 64),
  new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0x552200 })
);
scene.add(sun);

// 行星轨道组
const planets = [
  { name: '水星', radius: 0.18, distance: 2.0, speed: 2.2, color: 0xbbbbbb },
  { name: '金星', radius: 0.28, distance: 2.8, speed: 1.6, color: 0xffcc88 },
  { name: '地球', radius: 0.3, distance: 3.8, speed: 1.2, color: 0x3388ff },
  { name: '火星', radius: 0.24, distance: 4.8, speed: 1.0, color: 0xff5533 }
];

const orbits = [];
const meshes = [];
const card = createInfoCard({ title: '太阳系', text: '点击行星查看名称' });
card.el.style.zIndex = '10';

function createPlanet(p, index) {
  const orbit = new THREE.Object3D();
  scene.add(orbit);

  // 轨道线
  const points = [];
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a) * p.distance, 0, Math.sin(a) * p.distance));
  }
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x334455, transparent: true, opacity: 0.5 })
  );
  orbit.add(line);

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(p.radius, 32, 32),
    new THREE.MeshStandardMaterial({ color: p.color })
  );
  mesh.position.x = p.distance;
  mesh.userData = { name: p.name, distance: p.distance };
  orbit.add(mesh);
  orbits.push({ orbit, mesh, speed: p.speed, distance: p.distance, name: p.name });
  meshes.push(mesh);
}

planets.forEach(createPlanet);

stage.onUpdate((t) => {
  for (const o of orbits) {
    o.orbit.rotation.y = t * o.speed;
  }
});

// 点击行星显示名称
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const canvas = stage.renderer.domElement;

canvas.addEventListener('click', (event) => {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, stage.camera);
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length > 0) {
    card.setText(hits[0].object.userData.name || '未知行星');
  }
});

// 双击空白重置
canvas.addEventListener('dblclick', () => stage.reset());