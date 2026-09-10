/**
 * Teacher DSH Artifact SDK 交互规范：
 * - 1920x1080 友好，兼容 1366x768
 * - 按钮 >= 40px
 * - 课堂显示字体 >= 18px
 * - 主要操作支持鼠标和触摸
 * - 禁止 hover-only interaction
 * - 默认提供全屏、重置按钮
 */
export const TEACHER_UI = Object.freeze({
  MIN_BUTTON_SIZE: 40,
  MIN_FONT_SIZE: 18,
  FONT_FAMILY: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif',
  TOOLBAR_HEIGHT: 52,
  PANEL_RADIUS: 10,
  PRIMARY_COLOR: '#2563eb',
  DANGER_COLOR: '#dc2626',
  BACKGROUND: '#0f172a',
  SURFACE: '#ffffff',
  SURFACE_DARK: '#1e293b',
  TEXT: '#0f172a',
  TEXT_LIGHT: '#f8fafc',
  FONT_SIZE_LARGE: 22,
  FONT_SIZE_BODY: 18,
  FONT_SIZE_CAPTION: 15
});