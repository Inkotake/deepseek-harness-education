import PptxGenJS from 'pptxgenjs';

export const TEACHING_THEMES = {
  modern: {
    fontFace: 'Microsoft YaHei',
    headFontFace: 'Microsoft YaHei',
    color: '#0F172A',
    accent: '#2563EB',
    light: '#F1F5F9'
  },
  warm: {
    fontFace: 'Microsoft YaHei',
    headFontFace: 'Microsoft YaHei',
    color: '#1C1917',
    accent: '#EA580C',
    light: '#FFF7ED'
  },
  green: {
    fontFace: 'Microsoft YaHei',
    headFontFace: 'Microsoft YaHei',
    color: '#111827',
    accent: '#059669',
    light: '#ECFDF5'
  }
};

/**
 * 创建教学 PPT deck。
 *
 * 用法：
 * const deck = createTeachingDeck({ title: '牛顿第二定律', subtitle: '高一物理' });
 * deck.addConceptSlide({ title: '牛顿第二定律', points: [...], formula: 'F = ma' });
 * deck.addExperimentSlide({ title: '实验：...', steps: [...], conclusion: '...' });
 * deck.addQuestionSlide({ title: '课堂练习', questions: [{ text: '...', options: ['A...'], answer: 'A' }] });
 * await deck.save('牛顿第二定律.pptx');
 */
export function createTeachingDeck({
  title = '教学课件',
  subtitle = '',
  author = 'Teacher DSH',
  ratio = '16x9',
  theme = 'modern',
  subject = ''
} = {}) {
  const pptx = new PptxGenJS();
  const t = TEACHING_THEMES[theme] || TEACHING_THEMES.modern;

  pptx.defineLayout({ name: 'TEACH_16x9', width: 13.33, height: 7.5 });
  pptx.layout = ratio === '4x3' ? 'LAYOUT_4x3' : 'TEACH_16x9';
  pptx.author = author;
  pptx.company = 'Teacher DSH';
  pptx.title = title;

  const deck = {
    pptx,
    theme: t,
    title,
    subtitle,
    subject,
    slideCount: 0,

    _addBase(slideTitle) {
      const slide = pptx.addSlide();
      slide.background = { color: '#FFFFFF' };
      this.slideCount += 1;
      this._addHeader(slide, slideTitle);
      this._addFooter(slide);
      return slide;
    },

    _addHeader(slide, text) {
      if (!text) return;
      slide.addText(text, {
        x: 0.55, y: 0.35, w: 12.2, h: 0.7,
        fontSize: 30, bold: true, color: t.color, fontFace: t.headFontFace
      });
      slide.addShape('rect', { x: 0.55, y: 1.05, w: 1.6, h: 0.06, fill: { color: t.accent } });
    },

    _addFooter(slide) {
      slide.addText(this.title || '', {
        x: 0.55, y: 7.0, w: 10, h: 0.35,
        fontSize: 10, color: '#64748B', fontFace: t.fontFace
      });
      slide.addText(String(this.slideCount), {
        x: 12.3, y: 7.0, w: 0.6, h: 0.35,
        fontSize: 10, color: '#64748B', align: 'right', fontFace: t.fontFace
      });
    },

    addTitleSlide({ title = this.title, subtitle = this.subtitle, date = '' } = {}) {
      const slide = pptx.addSlide();
      slide.background = { color: t.accent };
      slide.addText(title, {
        x: 0.8, y: 2.2, w: 11.7, h: 1.6,
        fontSize: 44, bold: true, color: '#FFFFFF', fontFace: t.headFontFace
      });
      const lines = [subtitle, this.subject, date].filter(Boolean);
      if (lines.length) {
        slide.addText(lines.join('  ·  '), {
          x: 0.8, y: 3.9, w: 11.7, h: 0.8,
          fontSize: 20, color: '#E2E8F0', fontFace: t.fontFace
        });
      }
      this.slideCount += 1;
      return slide;
    },

    addSectionSlide({ section = '', hint = '' } = {}) {
      const slide = pptx.addSlide();
      slide.background = { color: '#0F172A' };
      slide.addText(section, {
        x: 0.8, y: 2.9, w: 11.7, h: 1.2,
        fontSize: 40, bold: true, color: '#FFFFFF', fontFace: t.headFontFace
      });
      if (hint) {
        slide.addText(hint, {
          x: 0.8, y: 4.2, w: 11.7, h: 0.6,
          fontSize: 18, color: '#94A3B8', fontFace: t.fontFace
        });
      }
      this.slideCount += 1;
      return slide;
    },

    addConceptSlide({ title = '', points = [], formula = '', note = '' } = {}) {
      const slide = this._addBase(title);
      const bullets = points.map((p) => ({ text: p, options: { bullet: { characterCode: '25CF' }, color: t.color, fontSize: 20, breakLine: true } }));
      slide.addText(bullets, {
        x: 0.8, y: 1.5, w: 7.2, h: 4.8,
        fontFace: t.fontFace, color: t.color, lineSpacingMultiple: 1.3, valign: 'top'
      });
      if (formula) {
        slide.addText(formula, {
          x: 8.3, y: 1.7, w: 4.3, h: 1.1,
          fontSize: 28, bold: true, italic: true, color: t.accent,
          fontFace: 'Cambria Math', align: 'center', fill: { color: t.light }
        });
      }
      if (note) {
        slide.addText(note, {
          x: 8.3, y: 3.1, w: 4.3, h: 2.0,
          fontSize: 14, color: '#475569', fontFace: t.fontFace, valign: 'top'
        });
      }
      return slide;
    },

    addExperimentSlide({ title = '', goal = '', steps = [], conclusion = '' } = {}) {
      const slide = this._addBase(title);
      const lines = [];
      if (goal) lines.push({ text: '实验目的：' + goal, options: { bold: true, color: t.color, fontSize: 18, breakLine: true } });
      lines.push({ text: '步骤：', options: { bold: true, color: t.accent, fontSize: 18, breakLine: true } });
      for (const [i, s] of steps.entries()) {
        lines.push({ text: `${i + 1}. ${s}`, options: { color: t.color, fontSize: 17, breakLine: true } });
      }
      if (conclusion) {
        lines.push({ text: '结论：' + conclusion, options: { bold: true, color: t.color, fontSize: 18, breakLine: true } });
      }
      slide.addText(lines, {
        x: 0.8, y: 1.5, w: 11.7, h: 4.9,
        fontFace: t.fontFace, lineSpacingMultiple: 1.25, valign: 'top'
      });
      return slide;
    },

    addQuestionSlide({ title = '课堂练习', questions = [] } = {}) {
      const slide = this._addBase(title);
      const lines = [];
      for (const [i, q] of questions.entries()) {
        lines.push({ text: `${i + 1}. ${q.text}`, options: { bold: true, color: t.color, fontSize: 18, breakLine: true } });
        if (q.options?.length) {
          lines.push({ text: q.options.map((o, j) => `${String.fromCharCode(65 + j)}. ${o}`).join('    '), options: { color: '#334155', fontSize: 16, breakLine: true } });
        }
        if (q.answer) {
          lines.push({ text: `参考答案：${q.answer}`, options: { color: t.accent, fontSize: 14, breakLine: true } });
        }
        lines.push({ text: '', options: { fontSize: 8, breakLine: true } });
      }
      slide.addText(lines, {
        x: 0.8, y: 1.5, w: 11.7, h: 4.9,
        fontFace: t.fontFace, lineSpacingMultiple: 1.2, valign: 'top'
      });
      return slide;
    },

    addSummarySlide({ title = '本节小结', points = [] } = {}) {
      return this.addConceptSlide({ title, points });
    },

    addImageSlide({ title = '', imagePath = '', caption = '' } = {}) {
      const slide = this._addBase(title);
      if (imagePath) {
        slide.addImage({ path: imagePath, x: 0.8, y: 1.5, w: 8.0, h: 4.8, sizing: { type: 'contain', w: 8.0, h: 4.8 } });
      }
      if (caption) {
        slide.addText(caption, {
          x: 9.0, y: 1.5, w: 3.8, h: 4.8,
          fontSize: 16, color: '#475569', fontFace: t.fontFace, valign: 'top'
        });
      }
      return slide;
    },

    async save(fileName) {
      const out = fileName || `${this.title || 'teaching-deck'}.pptx`;
      await pptx.writeFile({ fileName: out });
      return out;
    }
  };

  return deck;
}

export { PptxGenJS };
export default createTeachingDeck;