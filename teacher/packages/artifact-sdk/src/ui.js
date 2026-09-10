import { TEACHER_UI } from './constants.js';

function ensureFont(el) {
  el.style.fontFamily = TEACHER_UI.FONT_FAMILY;
  return el;
}

function hostOf(container) {
  return typeof container === 'string' ? document.querySelector(container) : container;
}

/**
 * 课堂按钮基元：最小 40px，字号 >= 18px，支持触摸。
 * 所有交互组件都走这里，保证课堂投影下的一致观感。
 */
export function createButton(label, { primary = false, onClick, title = '', container = null } = {}) {
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
  ensureFont(btn);
  if (title) btn.setAttribute('title', title);
  if (onClick) btn.addEventListener('click', onClick);
  const host = hostOf(container);
  if (host) host.appendChild(btn);
  return btn;
}

/** 兼容早期模板使用的内部按钮工厂。 */
const makeButton = (label, options) => createButton(label, options);

export function createFullscreenButton(container = document.body, onToggle) {
  const btn = makeButton('全屏', {
    title: '全屏切换',
    onClick: () => {
      if (document.fullscreenElement) {
        document.exitFullscreen?.();
      } else {
        (document.documentElement || container).requestFullscreen?.();
      }
      if (onToggle) onToggle(!document.fullscreenElement);
    }
  });
  return btn;
}

export function createResetButton(onReset) {
  return makeButton('重置', { primary: true, title: '重置视图', onClick: onReset });
}

export function createPauseButton({ initial = false, onToggle } = {}) {
  let paused = initial;
  const btn = makeButton(paused ? '继续' : '暂停', {
    title: '暂停/继续',
    onClick: () => {
      paused = !paused;
      btn.textContent = paused ? '继续' : '暂停';
      if (onToggle) onToggle(paused);
    }
  });
  return btn;
}

/** 开关：返回 { el, input, get value, setValue, toggle }。 */
export function createToggle({ label = '', value = false, onChange, container = document.body } = {}) {
  const wrap = document.createElement('label');
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '10px';
  wrap.style.minHeight = '44px';
  wrap.style.fontSize = `${TEACHER_UI.MIN_FONT_SIZE}px`;
  wrap.style.cursor = 'pointer';
  ensureFont(wrap);

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(value);
  input.style.width = '24px';
  input.style.height = '24px';
  input.style.touchAction = 'manipulation';

  const text = document.createElement('span');
  text.textContent = label;

  input.addEventListener('change', () => {
    if (onChange) onChange(input.checked, input);
  });
  wrap.append(input, text);
  const host = hostOf(container);
  if (host) host.appendChild(wrap);
  return {
    el: wrap,
    input,
    get value() { return input.checked; },
    setValue(v) {
      input.checked = Boolean(v);
      if (onChange) onChange(input.checked, input);
    },
    toggle() { this.setValue(!input.checked); }
  };
}

/** 下拉选择：返回 { el, select, get value, setValue }。 */
export function createSelect({ label = '', options = [], value, onChange, container = document.body } = {}) {
  const wrap = document.createElement('label');
  wrap.style.display = 'grid';
  wrap.style.gridTemplateColumns = 'auto 1fr';
  wrap.style.gap = '10px';
  wrap.style.alignItems = 'center';
  wrap.style.minHeight = '44px';
  wrap.style.fontSize = `${TEACHER_UI.MIN_FONT_SIZE}px`;
  ensureFont(wrap);

  const labelEl = document.createElement('span');
  labelEl.textContent = label;

  const select = document.createElement('select');
  select.style.minHeight = '40px';
  select.style.fontSize = `${TEACHER_UI.MIN_FONT_SIZE}px`;
  select.style.padding = '4px 8px';
  select.style.touchAction = 'manipulation';
  for (const option of options) {
    const item = document.createElement('option');
    if (typeof option === 'string') {
      item.value = option;
      item.textContent = option;
    } else {
      item.value = String(option.value);
      item.textContent = option.label ?? String(option.value);
    }
    select.appendChild(item);
  }
  if (value !== undefined) select.value = String(value);
  select.addEventListener('change', () => {
    if (onChange) onChange(select.value, select);
  });

  wrap.append(labelEl, select);
  const host = hostOf(container);
  if (host) host.appendChild(wrap);
  return {
    el: wrap,
    select,
    get value() { return select.value; },
    setValue(v) {
      select.value = String(v);
      if (onChange) onChange(select.value, select);
    }
  };
}

/** 数值读数：课堂投影用的高对比数字显示。 */
export function createReadout({ label = '', value = '', unit = '', container = document.body } = {}) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'baseline';
  wrap.style.gap = '8px';
  wrap.style.fontSize = `${TEACHER_UI.FONT_SIZE_BODY}px`;
  ensureFont(wrap);

  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const valueEl = document.createElement('strong');
  valueEl.textContent = String(value);
  valueEl.style.fontSize = `${TEACHER_UI.FONT_SIZE_LARGE}px`;
  valueEl.style.fontVariantNumeric = 'tabular-nums';
  const unitEl = document.createElement('span');
  unitEl.textContent = unit;
  unitEl.style.color = '#64748B';

  wrap.append(labelEl, valueEl, unitEl);
  const host = hostOf(container);
  if (host) host.appendChild(wrap);
  return {
    el: wrap,
    valueEl,
    setText(v) { valueEl.textContent = String(v); }
  };
}

/** 步进控制：上一步 / 下一步，适合实验分步演示。 */
export function createStepControls({ steps = 0, index = 0, onChange, container = document.body } = {}) {
  let current = index;
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '10px';
  ensureFont(wrap);

  const prev = createButton('上一步', { onClick: () => go(current - 1) });
  const next = createButton('下一步', { primary: true, onClick: () => go(current + 1) });
  const label = document.createElement('span');
  label.style.fontSize = `${TEACHER_UI.FONT_SIZE_BODY}px`;
  label.style.minWidth = '90px';
  label.style.textAlign = 'center';

  function render() {
    label.textContent = steps > 0 ? `第 ${current + 1} / ${steps} 步` : `第 ${current + 1} 步`;
    prev.disabled = current <= 0;
    next.disabled = steps > 0 && current >= steps - 1;
    prev.style.opacity = prev.disabled ? '0.45' : '1';
    next.style.opacity = next.disabled ? '0.45' : '1';
  }

  function go(nextIndex) {
    if (steps > 0 && (nextIndex < 0 || nextIndex > steps - 1)) return;
    if (steps === 0 && nextIndex < 0) return;
    current = nextIndex;
    render();
    if (onChange) onChange(current);
  }

  wrap.append(prev, label, next);
  render();
  const host = hostOf(container);
  if (host) host.appendChild(wrap);
  return { el: wrap, get index() { return current; }, go, render };
}

/** 图例：颜色 + 文字，避免只靠颜色传达信息。 */
export function createLegend({ items = [], container = document.body } = {}) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexWrap = 'wrap';
  wrap.style.gap = '14px';
  wrap.style.fontSize = `${TEACHER_UI.FONT_SIZE_CAPTION}px`;
  ensureFont(wrap);
  for (const item of items) {
    const entry = document.createElement('span');
    entry.style.display = 'inline-flex';
    entry.style.alignItems = 'center';
    entry.style.gap = '6px';
    const dot = document.createElement('span');
    dot.style.width = '14px';
    dot.style.height = '14px';
    dot.style.borderRadius = '3px';
    dot.style.display = 'inline-block';
    dot.style.background = item.color || '#2563EB';
    const text = document.createElement('span');
    text.textContent = item.label || item.text || '';
    entry.append(dot, text);
    wrap.appendChild(entry);
  }
  const host = hostOf(container);
  if (host) host.appendChild(wrap);
  return wrap;
}

/** 加载指示器：慢资源 / 模型加载时给出反馈，避免白屏。 */
export function createLoadingIndicator({ text = '正在加载…', container = document.body } = {}) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '10px';
  wrap.style.padding = '8px 14px';
  wrap.style.borderRadius = '8px';
  wrap.style.background = 'rgba(15,23,42,0.82)';
  wrap.style.color = TEACHER_UI.TEXT_LIGHT;
  wrap.style.fontSize = `${TEACHER_UI.FONT_SIZE_BODY}px`;
  wrap.style.position = 'absolute';
  wrap.style.left = '50%';
  wrap.style.top = '50%';
  wrap.style.transform = 'translate(-50%, -50%)';
  wrap.style.zIndex = '20';
  ensureFont(wrap);

  const spinner = document.createElement('span');
  spinner.textContent = '◌';
  spinner.style.animation = 'tdsh-spin 1s linear infinite';
  spinner.style.display = 'inline-block';
  const label = document.createElement('span');
  label.textContent = text;
  wrap.append(spinner, label);

  if (!document.getElementById('tdsh-spin-style')) {
    const style = document.createElement('style');
    style.id = 'tdsh-spin-style';
    style.textContent = '@keyframes tdsh-spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }

  const host = hostOf(container);
  if (host) {
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(wrap);
  }
  return {
    el: wrap,
    setText(v) { label.textContent = v; },
    hide() { wrap.remove(); }
  };
}

/** 可见的错误浮层：WebGL 不可用等情况必须给中文提示，而不是白屏。 */
export function createErrorOverlay({ title = '无法显示内容', detail = '', container = document.body } = {}) {
  const wrap = document.createElement('div');
  wrap.style.position = 'absolute';
  wrap.style.inset = '0';
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.alignItems = 'center';
  wrap.style.justifyContent = 'center';
  wrap.style.gap = '10px';
  wrap.style.padding = '24px';
  wrap.style.textAlign = 'center';
  wrap.style.background = 'rgba(15,23,42,0.92)';
  wrap.style.color = TEACHER_UI.TEXT_LIGHT;
  wrap.style.zIndex = '30';
  ensureFont(wrap);

  const heading = document.createElement('div');
  heading.textContent = title;
  heading.style.fontSize = `${TEACHER_UI.FONT_SIZE_LARGE}px`;
  heading.style.fontWeight = '700';
  const body = document.createElement('div');
  body.textContent = detail;
  body.style.fontSize = `${TEACHER_UI.FONT_SIZE_BODY}px`;
  body.style.lineHeight = '1.6';
  body.style.maxWidth = '600px';
  wrap.append(heading, body);

  const host = hostOf(container);
  if (host) {
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(wrap);
  }
  return { el: wrap, setDetail(v) { body.textContent = v; }, hide() { wrap.remove(); } };
}

export function createTeacherToolbar({ container = document.body, onReset, extra = [] } = {}) {
  const bar = document.createElement('div');
  bar.className = 'tdsh-toolbar';
  bar.style.position = 'absolute';
  bar.style.top = '12px';
  bar.style.right = '12px';
  bar.style.zIndex = '10';
  bar.style.display = 'flex';
  bar.style.gap = '10px';
  bar.style.alignItems = 'center';
  bar.style.flexWrap = 'wrap';
  bar.style.justifyContent = 'flex-end';

  const resetBtn = createResetButton(onReset || (() => {}));
  const fullscreenBtn = createFullscreenButton(container);
  bar.append(...extra, resetBtn, fullscreenBtn);

  const host = hostOf(container);
  if (host) {
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(bar);
  }

  return {
    el: bar,
    resetBtn,
    fullscreenBtn,
    destroy() { bar.remove(); }
  };
}

/** 课堂友好滑块：label + 数值 + input[type=range]，最小高度 44px。 */
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
  wrap.style.cursor = 'pointer';
  ensureFont(wrap);

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
  const host = hostOf(container);
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

/** 控制面板：统一视觉，可折叠。 */
export function createPanel({
  title = '控制面板',
  container = document.body,
  open = true,
  dock = 'right'
} = {}) {
  const panel = document.createElement('section');
  panel.className = 'tdsh-panel';
  panel.style.background = 'rgba(255,255,255,0.96)';
  panel.style.color = TEACHER_UI.TEXT;
  panel.style.borderRadius = `${TEACHER_UI.PANEL_RADIUS}px`;
  panel.style.padding = '12px 16px';
  panel.style.boxShadow = '0 10px 30px rgba(0,0,0,0.18)';
  panel.style.maxWidth = '380px';
  panel.style.maxHeight = 'calc(100vh - 24px)';
  panel.style.overflowY = 'auto';
  panel.style.pointerEvents = 'auto';
  if (dock === 'right') panel.style.marginLeft = 'auto';
  ensureFont(panel);

  const header = document.createElement('h2');
  header.textContent = title;
  header.style.margin = '0 0 8px 0';
  header.style.fontSize = `${TEACHER_UI.FONT_SIZE_LARGE}px`;
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.gap = '10px';

  const titleEl = document.createElement('span');
  titleEl.textContent = title;
  titleEl.style.flex = '1';

  const body = document.createElement('div');
  body.className = 'tdsh-panel-body';
  body.style.display = open ? 'grid' : 'none';
  body.style.gap = '6px';

  const toggle = makeButton(open ? '收起' : '展开', {
    title: '展开/收起控制面板',
    onClick: () => {
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? 'grid' : 'none';
      toggle.textContent = hidden ? '收起' : '展开';
    }
  });
  toggle.style.minHeight = '36px';
  toggle.style.fontSize = '14px';

  header.append(titleEl, toggle);
  panel.append(header, body);
  const host = hostOf(container);
  if (host) host.appendChild(panel);

  return {
    el: panel,
    body,
    add(el) { body.appendChild(el); return el; },
    setTitle(v) { titleEl.textContent = v; },
    remove() { panel.remove(); }
  };
}

/** 信息卡片：课堂展示用，字号大、对比度高。 */
export function createInfoCard({ title = '', text = '', container = document.body, position = 'left' } = {}) {
  const card = document.createElement('div');
  card.className = 'tdsh-info-card';
  card.style.position = 'absolute';
  card.style[position] = '12px';
  card.style.top = '12px';
  card.style.zIndex = '10';
  card.style.background = 'rgba(15,23,42,0.8)';
  card.style.color = TEACHER_UI.TEXT_LIGHT;
  card.style.padding = '12px 16px';
  card.style.borderRadius = `${TEACHER_UI.PANEL_RADIUS}px`;
  card.style.fontSize = `${TEACHER_UI.FONT_SIZE_BODY}px`;
  card.style.maxWidth = '420px';
  card.style.pointerEvents = 'none';
  ensureFont(card);

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

  const host = hostOf(container);
  if (host) {
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(card);
  }
  return {
    el: card,
    setText(v) { t.textContent = v; },
    setTitle(v) { if (card.firstChild) card.firstChild.textContent = v; },
    remove() { card.remove(); }
  };
}

export function createLabel(text, { container = document.body, fontSize = TEACHER_UI.FONT_SIZE_BODY } = {}) {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.fontSize = `${fontSize}px`;
  el.style.color = TEACHER_UI.TEXT;
  ensureFont(el);
  const host = hostOf(container);
  if (host) host.appendChild(el);
  return el;
}
