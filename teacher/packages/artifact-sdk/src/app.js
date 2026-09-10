import { TEACHER_UI } from './constants.js';
import {
  createErrorOverlay,
  createLoadingIndicator,
  createPanel,
  createTeacherToolbar
} from './ui.js';

/**
 * Teacher DSH 教具应用外壳。
 *
 * 统一课堂投影下的布局与交互：
 * - 顶部标题区（可选）
 * - 主舞台区（挂 Three.js / JSXGraph / Canvas）
 * - 右侧或底部控制面板区（响应式）
 * - 全屏 / 重置工具栏
 * - 加载指示器与错误浮层
 *
 * 用法：
 * const app = createTeachingApp({ title: '太阳系', subtitle: '地理 · 七年级' });
 * const stage = createStage({ mount: app.stage, onReset: () => app.reset() });
 * const panel = app.createPanel({ title: '控制' });
 * panel.add(createSlider({ label: '速度', container: panel.body }));
 */
export function createTeachingApp({
  mount = document.body,
  title = '',
  subtitle = '',
  dock = 'right',
  toolbar = true,
  onReset
} = {}) {
  const host = typeof mount === 'string' ? document.querySelector(mount) : mount;
  if (!host) throw new Error('[artifact-sdk] createTeachingApp: mount element not found');

  const previousPosition = host.style.position;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  const root = document.createElement('div');
  root.className = 'tdsh-app';
  root.style.position = 'absolute';
  root.style.inset = '0';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.fontFamily = TEACHER_UI.FONT_FAMILY;
  root.style.background = `#${TEACHER_UI.BACKGROUND.replace('#', '')}`;
  root.style.overflow = 'hidden';

  let header = null;
  if (title || subtitle) {
    header = document.createElement('header');
    header.style.flex = '0 0 auto';
    header.style.padding = '10px 16px';
    header.style.background = 'rgba(15,23,42,0.92)';
    header.style.color = TEACHER_UI.TEXT_LIGHT;
    header.style.borderBottom = '1px solid rgba(255,255,255,0.12)';
    const h1 = document.createElement('div');
    h1.textContent = title;
    h1.style.fontSize = `${TEACHER_UI.FONT_SIZE_LARGE}px`;
    h1.style.fontWeight = '700';
    header.appendChild(h1);
    if (subtitle) {
      const h2 = document.createElement('div');
      h2.textContent = subtitle;
      h2.style.fontSize = `${TEACHER_UI.FONT_SIZE_CAPTION}px`;
      h2.style.opacity = '0.8';
      header.appendChild(h2);
    }
  }

  const main = document.createElement('div');
  main.style.flex = '1 1 auto';
  main.style.display = 'flex';
  main.style.flexDirection = dock === 'bottom' ? 'column' : 'row';
  main.style.minHeight = '0';
  main.style.position = 'relative';

  const stage = document.createElement('div');
  stage.className = 'tdsh-stage';
  stage.style.flex = '1 1 auto';
  stage.style.position = 'relative';
  stage.style.minWidth = '0';
  stage.style.minHeight = '0';
  stage.style.overflow = 'hidden';

  const dockEl = document.createElement('aside');
  dockEl.className = 'tdsh-dock';
  dockEl.style.flex = '0 0 auto';
  dockEl.style.display = 'flex';
  dockEl.style.flexDirection = 'column';
  dockEl.style.gap = '10px';
  dockEl.style.padding = '12px';
  dockEl.style.overflowY = 'auto';
  dockEl.style.maxHeight = dock === 'bottom' ? '42vh' : '100%';
  dockEl.style.maxWidth = dock === 'bottom' ? 'none' : '420px';
  dockEl.style.pointerEvents = 'none';
  dockEl.style.background = 'linear-gradient(180deg, rgba(15,23,42,0.0), rgba(15,23,42,0.35))';

  main.append(stage, dockEl);
  root.append(...[header, main].filter(Boolean));
  host.appendChild(root);

  let toolbarHandle = null;
  if (toolbar) {
    toolbarHandle = createTeacherToolbar({ container: stage, onReset });
  }
  const loading = createLoadingIndicator({ container: stage });
  loading.setText('正在准备课堂内容…');

  let disposed = false;

  return {
    root,
    header,
    main,
    stage,
    dock: dockEl,
    toolbar: toolbarHandle,

    /** 创建一个停靠在控制区的面板。 */
    createPanel(options = {}) {
      const panel = createPanel({ container: dockEl, ...options });
      panel.el.style.pointerEvents = 'auto';
      panel.el.style.maxWidth = 'none';
      return panel;
    },

    hideLoading() {
      loading.hide();
    },

    setLoadingText(text) {
      loading.setText(text);
    },

    /** 显示课堂可读的错误信息（例如 WebGL 不可用）。 */
    showError(title, detail) {
      loading.hide();
      return createErrorOverlay({ title, detail, container: stage });
    },

    reset() {
      if (onReset) onReset();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      loading.hide();
      if (toolbarHandle) toolbarHandle.destroy();
      root.remove();
      host.style.position = previousPosition;
    }
  };
}
