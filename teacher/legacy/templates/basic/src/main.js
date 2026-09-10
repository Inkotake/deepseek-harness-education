import '@teacher-dsh/artifact-sdk/style.css';
import { createPanel, createSlider, createTeacherToolbar } from '@teacher-dsh/artifact-sdk';

document.querySelector('#app').innerHTML = `
  <div style="display:grid;place-items:center;min-height:100vh;background:#0f172a;color:#f8fafc;font-size:22px;text-align:center;">
    <div>
      <h1>教学演示</h1>
      <p>替换 src/main.js，开始创建你的教具。</p>
    </div>
  </div>`;

createTeacherToolbar({ container: document.body, onReset: () => location.reload() });

const panel = createPanel({ title: '控制面板', container: document.body });
panel.el.style.position = 'absolute';
panel.el.style.left = '12px';
panel.el.style.top = '12px';
panel.el.style.zIndex = '10';

createSlider({
  label: '示例参数',
  min: 0,
  max: 10,
  step: 1,
  value: 5,
  unit: ' 档',
  container: panel.body,
  onChange: (v) => {
    document.querySelector('#app h1').textContent = `教学演示 ${v} 档`;
  }
});