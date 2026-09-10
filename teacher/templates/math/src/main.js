import '@teacher-dsh/artifact-sdk/style.css';
import JXG from 'jsxgraph';
import { createSlider, createTeacherToolbar, renderKatex } from '@teacher-dsh/artifact-sdk';

const board = JXG.JSXGraph.initBoard('jxgbox', {
  boundingbox: [-10, 10, 10, -10],
  axis: true,
  showCopyright: false
});

let a = 1, b = 0, c = 0;
const f = (x) => a * x * x + b * x + c;

const curve = board.create('functiongraph', [f, -10, 10], { strokeColor: '#2563eb', strokeWidth: 3 });

function updateFormula() {
  document.querySelector('#formula').innerHTML = renderKatex(
    `f(x) = ${a.toFixed(1)}x^2 + ${b.toFixed(1)}x + ${c.toFixed(1)}`
  );
}

const panel = document.createElement('div');
panel.id = 'panel';
panel.style.position = 'fixed';
panel.style.left = '12px';
panel.style.bottom = '12px';
panel.style.zIndex = '10';
panel.style.background = 'rgba(255,255,255,0.95)';
panel.style.padding = '12px 16px';
panel.style.borderRadius = '10px';
panel.style.minWidth = '300px';
document.body.appendChild(panel);

const formulaBox = document.querySelector('#formula');
formulaBox.style.position = 'fixed';
formulaBox.style.top = '12px';
formulaBox.style.left = '12px';
formulaBox.style.zIndex = '10';
formulaBox.style.background = 'rgba(15,23,42,0.85)';
formulaBox.style.color = '#f8fafc';
formulaBox.style.padding = '10px 16px';
formulaBox.style.borderRadius = '10px';
formulaBox.style.fontSize = '18px';

function update() {
  curve.Y = f;
  curve.update();
  updateFormula();
}

createSlider({ label: 'a', min: -5, max: 5, step: 0.1, value: 1, container: panel, onChange: (v) => { a = v; update(); } });
createSlider({ label: 'b', min: -5, max: 5, step: 0.1, value: 0, container: panel, onChange: (v) => { b = v; update(); } });
createSlider({ label: 'c', min: -5, max: 5, step: 0.1, value: 0, container: panel, onChange: (v) => { c = v; update(); } });

createTeacherToolbar({
  container: document.body,
  onReset: () => {
    a = 1; b = 0; c = 0;
    panel.querySelectorAll('input[type=range]').forEach((el, i) => {
      el.value = [1, 0, 0][i];
      el.dispatchEvent(new Event('input'));
    });
    update();
  }
});

updateFormula();