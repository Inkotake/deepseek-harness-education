import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * 将 LaTeX 公式渲染为 HTML 字符串（KaTeX）。
 * 返回 HTML 字符串，方便直接插入 DOM。
 */
export function renderKatex(latex, options = {}) {
  return katex.renderToString(latex, {
    throwOnError: false,
    displayMode: true,
    ...options
  });
}

export function renderKatexInline(latex, options = {}) {
  return katex.renderToString(latex, {
    throwOnError: false,
    displayMode: false,
    ...options
  });
}

/**
 * 创建一个公式面板，可以放多个公式。
 */
export function createFormulaPanel({ container = document.body, formulas = [] } = {}) {
  const panel = document.createElement('div');
  panel.className = 'tdsh-formula-panel';
  panel.style.position = 'absolute';
  panel.style.left = '12px';
  panel.style.bottom = '12px';
  panel.style.zIndex = '10';
  panel.style.background = 'rgba(255,255,255,0.96)';
  panel.style.padding = '12px 16px';
  panel.style.borderRadius = '10px';
  panel.style.boxShadow = '0 10px 30px rgba(0,0,0,0.18)';
  panel.style.maxWidth = '560px';
  panel.style.fontSize = '18px';

  function addFormula(latex, { display = true } = {}) {
    const wrap = document.createElement('div');
    wrap.innerHTML = renderKatex(latex, { displayMode: display });
    panel.appendChild(wrap);
    return wrap;
  }

  for (const f of formulas) addFormula(f.latex || f, f);

  const host = typeof container === 'string' ? document.querySelector(container) : container;
  if (host) host.appendChild(panel);

  return {
    el: panel,
    addFormula,
    clear() { panel.innerHTML = ''; },
    remove() { panel.remove(); }
  };
}