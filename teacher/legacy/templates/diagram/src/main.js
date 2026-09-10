import '@teacher-dsh/artifact-sdk/style.css';
import mermaid from 'mermaid';
import { createTeacherToolbar } from '@teacher-dsh/artifact-sdk';

const code = `flowchart TD
  A[牛顿运动定律] --> B[牛顿第一定律]
  A --> C[牛顿第二定律]
  A --> D[牛顿第三定律]
  C --> E[F = ma]
  C --> F[加速度]`;

mermaid.initialize({ startOnLoad: false, theme: 'base', securityLevel: 'strict' });

const app = document.querySelector('#app');
app.style.minHeight = '100vh';
app.style.background = '#ffffff';
app.style.padding = '24px';
app.style.boxSizing = 'border-box';

async function render() {
  const { svg } = await mermaid.render('tdsh-diagram', code);
  app.innerHTML = `<div style="display:grid;place-items:center;min-height:80vh;">${svg}</div>`;
}

render().catch((err) => {
  app.innerHTML = `<pre style="color:red">${String(err)}</pre>`;
});

createTeacherToolbar({ container: document.body, onReset: render });