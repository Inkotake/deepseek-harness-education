import { TEACHER_UI } from './constants.js';

function ensureFont(el) {
  el.style.fontFamily = TEACHER_UI.FONT_FAMILY;
  return el;
}

function makeButton(label, { primary = false, onClick } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.style.minWidth = `${TEACHER_UI.MIN_BUTTON_SIZE}px`;
  btn.style.minHeight = `${TEACHER_UI.MIN_BUTTON_SIZE}px`;
  btn.style.padding = '6px 14px';
  btn.style.fontSize = `${TEACHER_UI.MIN_FONT_SIZE}px`;
  btn.style.borderRadius = '8px';
  btn.style.border = primary ? 'none' : '1px solid rgba(255,255,255,0.35)';
  btn.style.background = primary ? TEACHER_UI.PRIMARY_COLOR : 'rgba(15,23,42,0.72)';
  btn.style.color = TEACHER_UI.TEXT_LIGHT;
  btn.style.cursor = 'pointer';
  btn.style.touchAction = 'manipulation';
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

export function createFullscreenButton(container = document.body, onToggle) {
  const btn = makeButton('全屏', {
    onClick: () => {
      if (document.fullscreenElement) {
        document.exitFullscreen?.();
      } else {
        (document.documentElement || container).requestFullscreen?.();
      }
      if (onToggle) onToggle(!document.fullscreenElement);
    }
  });
  btn.setAttribute('title', '全屏切换');
  return btn;
}

export function createResetButton(onReset) {
  const btn = makeButton('重置', { primary: true, onClick: onReset });
  btn.setAttribute('title', '重置视图');
  return btn;
}

export function createPauseButton({ initial = false, onToggle } = {}) {
  let paused = initial;
  const btn = makeButton(paused ? '继续' : '暂停', {
    onClick: () => {
      paused = !paused;
      btn.textContent = paused ? '继续' : '暂停';
      if (onToggle) onToggle(paused);
    }
  });
  btn.setAttribute('title', '暂停/继续');
  return btn;
}

/**
 * 教师工具栏：固定在右上角，不遮挡内容，按钮 >= 40px，支持触摸。
 */
export function createTeacherToolbar({ container = document.body, onReset } = {}) {
  const bar = document.createElement('div');
  bar.className = 'tdsh-toolbar';
  bar.style.position = 'absolute';
  bar.style.top = '12px';
  bar.style.right = '12px';
  bar.style.zIndex = '10';
  bar.style.display = 'flex';
  bar.style.gap = '10px';
  bar.style.alignItems = 'center';

  const resetBtn = createResetButton(onReset || (() => {}));
  const fullscreenBtn = createFullscreenButton(container);
  bar.append(resetBtn, fullscreenBtn);

  const host = typeof container === 'string' ? document.querySelector(container) : container;
  if (host) host.appendChild(bar);

  return {
    el: bar,
    resetBtn,
    fullscreenBtn,
    destroy() { bar.remove(); }
  };
}

/**
 * 创建一个课堂友好滑块（label + value 显示 + input[type=range]）。
 * 高度 >= 40px，字号 >= 18px，支持触摸。
 */
export function createSlider({
  label = '',
  min = 0,
  max = 10,
  step = 0.1,
  value = min,
  unit = '',
  onChange,
  container = document.body
} = {}) {
  const wrap = document.createElement('label');
  wrap.style.display = 'grid';
  wrap.style.gridTemplateColumns = 'auto 1fr auto';
  wrap.style.gap = '10px';
  wrap.style.alignItems = 'center';
  wrap.style.minHeight = '44px';
  wrap.style.fontSize = `${TEACHER_UI.MIN_FONT_SIZE}px`;
  wrap.style.fontFamily = TEACHER_UI.FONT_FAMILY;
  wrap.style.cursor = 'pointer';

  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  labelEl.style.whiteSpace = 'nowrap';

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.style.width = '100%';
  input.style.minHeight = '40px';
  input.style.touchAction = 'manipulation';

  const valueEl = document.createElement('span');
  valueEl.style.minWidth = '72px';
  valueEl.style.textAlign = 'right';
  valueEl.style.fontVariantNumeric = 'tabular-nums';
  const fmt = (v) => `${Number(v).toFixed(step < 1 ? 2 : 0)}${unit}`;
  valueEl.textContent = fmt(value);

  input.addEventListener('input', () => {
    valueEl.textContent = fmt(input.value);
    if (onChange) onChange(Number(input.value), input);
  });

  wrap.append(labelEl, input, valueEl);
  const host = typeof container === 'string' ? document.querySelector(container) : container;
  if (host) host.appendChild(wrap);

  return {
    el: wrap,
    input,
    valueEl,
    get value() { return Number(input.value); },
    setValue(v) {
      input.value = String(v);
      valueEl.textContent = fmt(v);
      if (onChange) onChange(Number(v), input);
    }
  };
}

/**
 * 创建控制面板，统一视觉。
 */
export function createPanel({
  title = '控制面板',
  container = document.body,
  open = true
} = {}) {
  const panel = document.createElement('section');
  panel.className = 'tdsh-panel';
  panel.style.background = 'rgba(255,255,255,0.96)';
  panel.style.color = TEACHER_UI.TEXT;
  panel.style.borderRadius = `${TEACHER_UI.PANEL_RADIUS}px`;
  panel.style.padding = '12px 16px';
  panel.style.boxShadow = '0 10px 30px rgba(0,0,0,0.18)';
  panel.style.maxWidth = '360px';
  panel.style.fontFamily = TEACHER_UI.FONT_FAMILY;

  const header = document.createElement('h2');
  header.textContent = title;
  header.style.margin = '0 0 8px 0';
  header.style.fontSize = `${TEACHER_UI.FONT_SIZE_LARGE}px`;

  const body = document.createElement('div');
  body.className = 'tdsh-panel-body';
  body.style.display = 'grid';
  body.style.gap = '6px';

  const toggle = makeButton(open ? '收起' : '展开', {
    onClick: () => {
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? 'grid' : 'none';
      toggle.textContent = hidden ? '收起' : '展开';
    }
  });
  header.appendChild(toggle);
  toggle.style.float = 'right';
  toggle.style.marginLeft = '12px';
  toggle.style.minHeight = '36px';
  toggle.style.fontSize = '14px';

  panel.append(header, body);
  const host = typeof container === 'string' ? document.querySelector(container) : container;
  if (host) host.appendChild(panel);

  return {
    el: panel,
    body,
    add(el) { body.appendChild(el); return el; },
    remove() { panel.remove(); }
  };
}

/**
 * 信息卡片：课堂展示用，字体大、对比度高。
 */
export function createInfoCard({ title = '', text = '', container = document.body } = {}) {
  const card = document.createElement('div');
  card.className = 'tdsh-info-card';
  card.style.position = 'absolute';
  card.style.left = '12px';
  card.style.top = '12px';
  card.style.zIndex = '10';
  card.style.background = 'rgba(15,23,42,0.8)';
  card.style.color = TEACHER_UI.TEXT_LIGHT;
  card.style.padding = '12px 16px';
  card.style.borderRadius = `${TEACHER_UI.PANEL_RADIUS}px`;
  card.style.fontSize = `${TEACHER_UI.FONT_SIZE_BODY}px`;
  card.style.fontFamily = TEACHER_UI.FONT_FAMILY;
  card.style.maxWidth = '420px';

  if (title) {
    const h = document.createElement('div');
    h.textContent = title;
    h.style.fontWeight = '700';
    h.style.fontSize = `${TEACHER_UI.FONT_SIZE_LARGE}px`;
    h.style.marginBottom = '4px';
    card.appendChild(h);
  }
  const t = document.createElement('div');
  t.textContent = text;
  t.style.lineHeight = '1.5';
  card.appendChild(t);

  const host = typeof container === 'string' ? document.querySelector(container) : container;
  if (host) host.appendChild(card);
  return {
    el: card,
    setText(v) { t.textContent = v; },
    remove() { card.remove(); }
  };
}

export function createLabel(text, { container = document.body, fontSize = TEACHER_UI.FONT_SIZE_BODY } = {}) {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.fontSize = `${fontSize}px`;
  el.style.fontFamily = TEACHER_UI.FONT_FAMILY;
  el.style.color = TEACHER_UI.TEXT;
  const host = typeof container === 'string' ? document.querySelector(container) : container;
  if (host) host.appendChild(el);
  return el;
}