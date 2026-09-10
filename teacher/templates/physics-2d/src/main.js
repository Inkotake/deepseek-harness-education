import '@teacher-dsh/artifact-sdk/style.css';
import Matter from 'matter-js';
import { createPauseButton, createResetButton } from '@teacher-dsh/artifact-sdk';

const { Engine, Runner, Bodies, Composite } = Matter;

const engine = Engine.create({ gravity: { x: 0, y: 1 } });
const world = engine.world;

const width = window.innerWidth;
const height = window.innerHeight;

const ground = Bodies.rectangle(width / 2, height - 30, width, 60, { isStatic: true });
const leftWall = Bodies.rectangle(0, height / 2, 40, height * 2, { isStatic: true });
const rightWall = Bodies.rectangle(width, height / 2, 40, height * 2, { isStatic: true });
const ball = Bodies.circle(width / 2, 100, 25, { restitution: 0.82 });

Composite.add(world, [ground, leftWall, rightWall, ball]);

const runner = Runner.create();
Runner.run(runner, engine);

function reset() {
  Matter.Body.setPosition(ball, { x: width / 2, y: 100 });
  Matter.Body.setVelocity(ball, { x: 0, y: 0 });
}

const toolbar = document.querySelector('#toolbar');
toolbar.style.position = 'fixed';
toolbar.style.top = '12px';
toolbar.style.right = '12px';
toolbar.style.zIndex = '10';
toolbar.style.display = 'flex';
toolbar.style.gap = '10px';

toolbar.appendChild(createResetButton(reset));
toolbar.appendChild(createPauseButton({
  onToggle: (paused) => {
    if (paused) Runner.stop(runner);
    else Runner.start(runner, engine);
  }
}));

window.addEventListener('resize', () => {
  Matter.Body.setPosition(rightWall, { x: window.innerWidth, y: window.innerHeight / 2 });
  Matter.Body.setPosition(ground, { x: window.innerWidth / 2, y: window.innerHeight - 30 });
});