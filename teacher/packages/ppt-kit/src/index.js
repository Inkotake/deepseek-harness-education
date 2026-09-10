import PptxGenJS from 'pptxgenjs';

/** Teaching deck themes. Every deck is a real, editable OOXML presentation. */
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

const MATH_FONT = 'Cambria Math';
const CANVAS_WIDTH = 13.33;
const CANVAS_HEIGHT = 7.5;
const BODY_TOP = 1.5;
const BODY_HEIGHT = 4.9;
const MARGIN = 0.8;

/**
 * 创建教学 PPT deck。
 *
 * 用法：
 * const deck = createTeachingDeck({ title: '牛顿第二定律', subtitle: '高一物理' });
 * deck.addTitleSlide({});
 * deck.addConceptSlide({ title: '牛顿第二定律', points: [...], formula: 'F = ma' });
 * deck.addExperimentSlide({ title: '实验：...', steps: [...], conclusion: '...' });
 * deck.addExerciseSlide({ title: '课堂练习', questions: [{ text: '...', options: ['A...'], answer: 'A' }] });
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

  pptx.defineLayout({ name: 'TEACH_16x9', width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
  pptx.layout = ratio === '4x3' ? 'LAYOUT_4x3' : 'TEACH_16x9';
  pptx.author = author;
  pptx.company = 'Teacher DSH';
  pptx.title = title;

  /** Normalize one content string into a pptxgenjs text run. */
  const bullet = (text, overrides = {}) => ({
    text: String(text),
    options: { bullet: { characterCode: '25CF' }, color: t.color, fontSize: 20, breakLine: true, ...overrides }
  });

  /** Normalize a plain line of text into a pptxgenjs text run. */
  const line = (text, overrides = {}) => ({
    text: String(text),
    options: { color: t.color, fontSize: 17, breakLine: true, ...overrides }
  });

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

    _addBullets(slide, points, box = {}) {
      const bullets = (points || []).map((point) => (typeof point === 'string' ? bullet(point) : bullet(point.text, point.options)));
      if (bullets.length === 0) return;
      slide.addText(bullets, {
        x: MARGIN, y: BODY_TOP, w: 11.7, h: BODY_HEIGHT,
        fontFace: t.fontFace, color: t.color, lineSpacingMultiple: 1.3, valign: 'top',
        ...box
      });
    },

    addTitleSlide({ title = this.title, subtitle = this.subtitle, date = '' } = {}) {
      const slide = pptx.addSlide();
      slide.background = { color: t.accent };
      slide.addText(title, {
        x: MARGIN, y: 2.2, w: 11.7, h: 1.6,
        fontSize: 44, bold: true, color: '#FFFFFF', fontFace: t.headFontFace
      });
      const lines = [subtitle, this.subject, date].filter(Boolean);
      if (lines.length) {
        slide.addText(lines.join('  ·  '), {
          x: MARGIN, y: 3.9, w: 11.7, h: 0.8,
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
        x: MARGIN, y: 2.9, w: 11.7, h: 1.2,
        fontSize: 40, bold: true, color: '#FFFFFF', fontFace: t.headFontFace
      });
      if (hint) {
        slide.addText(hint, {
          x: MARGIN, y: 4.2, w: 11.7, h: 0.6,
          fontSize: 18, color: '#94A3B8', fontFace: t.fontFace
        });
      }
      this.slideCount += 1;
      return slide;
    },

    addConceptSlide({ title = '', points = [], formula = '', note = '' } = {}) {
      const slide = this._addBase(title);
      const hasSide = Boolean(formula || note);
      this._addBullets(slide, points, hasSide ? { w: 7.2 } : {});
      if (formula) {
        slide.addText(formula, {
          x: 8.3, y: 1.7, w: 4.3, h: 1.1,
          fontSize: 28, bold: true, italic: true, color: t.accent,
          fontFace: MATH_FONT, align: 'center', fill: { color: t.light }
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

    /** 两栏对照：左概念 / 右概念，或概念 / 例子。 */
    addTwoColumnSlide({ title = '', leftTitle = '', leftPoints = [], rightTitle = '', rightPoints = [], formula = '' } = {}) {
      const slide = this._addBase(title);
      const columnHeight = formula ? 4.0 : BODY_HEIGHT;
      const header = (text, x) => {
        if (!text) return;
        slide.addText(text, {
          x, y: BODY_TOP, w: 5.6, h: 0.5,
          fontSize: 21, bold: true, color: t.accent, fontFace: t.headFontFace
        });
      };
      header(leftTitle, MARGIN);
      header(rightTitle, MARGIN + 5.9);
      const bodyTop = leftTitle || rightTitle ? BODY_TOP + 0.6 : BODY_TOP;
      const rows = (points) => (points || []).map((point) => (typeof point === 'string' ? line(point) : line(point.text, point.options)));
      slide.addText(rows(leftPoints), {
        x: MARGIN, y: bodyTop, w: 5.6, h: columnHeight,
        fontFace: t.fontFace, lineSpacingMultiple: 1.25, valign: 'top'
      });
      slide.addText(rows(rightPoints), {
        x: MARGIN + 5.9, y: bodyTop, w: 5.6, h: columnHeight,
        fontFace: t.fontFace, lineSpacingMultiple: 1.25, valign: 'top'
      });
      if (formula) {
        slide.addText(formula, {
          x: MARGIN, y: 5.9, w: 11.7, h: 0.9,
          fontSize: 24, bold: true, italic: true, color: t.accent,
          fontFace: MATH_FONT, align: 'center', fill: { color: t.light }
        });
      }
      return slide;
    },

    /** 单独一页公式推导，逐行列出。 */
    addFormulaSlide({ title = '', formulas = [], note = '' } = {}) {
      const slide = this._addBase(title);
      const items = (formulas || []).map((entry) => {
        const latex = typeof entry === 'string' ? entry : entry.latex;
        const caption = typeof entry === 'string' ? '' : entry.caption;
        return {
          text: caption ? `${caption}    ${latex}` : latex,
          options: { color: t.color, fontSize: 24, italic: true, fontFace: MATH_FONT, breakLine: true, align: 'center' }
        };
      });
      if (items.length > 0) {
        slide.addText(items, {
          x: MARGIN, y: BODY_TOP + 0.3, w: 11.7, h: 3.6,
          fontFace: MATH_FONT, lineSpacingMultiple: 1.6, valign: 'middle'
        });
      }
      if (note) {
        slide.addText(note, {
          x: MARGIN, y: 5.7, w: 11.7, h: 1.0,
          fontSize: 15, color: '#475569', fontFace: t.fontFace, valign: 'top'
        });
      }
      return slide;
    },

    addExperimentSlide({ title = '', goal = '', steps = [], conclusion = '' } = {}) {
      const slide = this._addBase(title);
      const lines = [];
      if (goal) lines.push({ text: '实验目的：' + goal, options: { bold: true, color: t.color, fontSize: 18, breakLine: true } });
      lines.push({ text: '步骤：', options: { bold: true, color: t.accent, fontSize: 18, breakLine: true } });
      for (const [i, step] of (steps || []).entries()) {
        lines.push({ text: `${i + 1}. ${step}`, options: { color: t.color, fontSize: 17, breakLine: true } });
      }
      if (conclusion) {
        lines.push({ text: '结论：' + conclusion, options: { bold: true, color: t.color, fontSize: 18, breakLine: true } });
      }
      slide.addText(lines, {
        x: MARGIN, y: BODY_TOP, w: 11.7, h: BODY_HEIGHT,
        fontFace: t.fontFace, lineSpacingMultiple: 1.25, valign: 'top'
      });
      return slide;
    },

    /** 练习页：题干 + 选项，答案可选（答案页请用 addAnswerSlide）。 */
    addExerciseSlide({ title = '课堂练习', questions = [] } = {}) {
      return this.addQuestionSlide({ title, questions: (questions || []).map((q) => ({ ...q, answer: '' })) });
    },

    addQuestionSlide({ title = '课堂练习', questions = [] } = {}) {
      const slide = this._addBase(title);
      const lines = [];
      for (const [i, q] of (questions || []).entries()) {
        lines.push({ text: `${i + 1}. ${q.text}`, options: { bold: true, color: t.color, fontSize: 18, breakLine: true } });
        if (q.options?.length) {
          lines.push({
            text: q.options.map((option, j) => `${String.fromCharCode(65 + j)}. ${option}`).join('    '),
            options: { color: '#334155', fontSize: 16, breakLine: true }
          });
        }
        if (q.answer) {
          lines.push({ text: `参考答案：${q.answer}`, options: { color: t.accent, fontSize: 14, breakLine: true } });
        }
        lines.push({ text: '', options: { fontSize: 8, breakLine: true } });
      }
      slide.addText(lines, {
        x: MARGIN, y: BODY_TOP, w: 11.7, h: BODY_HEIGHT,
        fontFace: t.fontFace, lineSpacingMultiple: 1.2, valign: 'top'
      });
      return slide;
    },

    /** 答案页：显式分离，方便课堂先提问后揭晓。 */
    addAnswerSlide({ title = '参考答案', answers = [] } = {}) {
      const slide = this._addBase(title);
      const lines = (answers || []).map((answer, index) => {
        const text = typeof answer === 'string' ? answer : answer.text;
        const reason = typeof answer === 'string' ? '' : answer.reason;
        return {
          text: reason ? `${index + 1}. ${text}    —— ${reason}` : `${index + 1}. ${text}`,
          options: { color: t.accent, fontSize: 20, breakLine: true }
        };
      });
      slide.addText(lines, {
        x: MARGIN, y: BODY_TOP, w: 11.7, h: BODY_HEIGHT,
        fontFace: t.fontFace, lineSpacingMultiple: 1.35, valign: 'top'
      });
      return slide;
    },

    addSummarySlide({ title = '本节小结', points = [], homework = '' } = {}) {
      const slide = this.addConceptSlide({ title, points, note: homework ? '作业：' + homework : '' });
      return slide;
    },

    addImageSlide({ title = '', imagePath = '', caption = '' } = {}) {
      const slide = this._addBase(title);
      if (imagePath) {
        slide.addImage({ path: imagePath, x: MARGIN, y: BODY_TOP, w: 8.0, h: 4.8, sizing: { type: 'contain', w: 8.0, h: 4.8 } });
      }
      if (caption) {
        slide.addText(caption, {
          x: 9.0, y: BODY_TOP, w: 3.8, h: 4.8,
          fontSize: 16, color: '#475569', fontFace: t.fontFace, valign: 'top'
        });
      }
      return slide;
    },

    /** 图文页：左图右文，或右图左文。 */
    addImageTextSlide({ title = '', imagePath = '', imageSide = 'left', points = [], caption = '' } = {}) {
      const slide = this._addBase(title);
      const imageX = imageSide === 'left' ? MARGIN : MARGIN + 6.3;
      const textX = imageSide === 'left' ? MARGIN + 6.3 : MARGIN;
      if (imagePath) {
        slide.addImage({
          path: imagePath, x: imageX, y: BODY_TOP, w: 5.4, h: 4.8,
          sizing: { type: 'contain', w: 5.4, h: 4.8 }
        });
      }
      const content = (points || []).map((point) => (typeof point === 'string' ? line(point) : line(point.text, point.options)));
      if (caption) content.unshift({ text: caption, options: { italic: true, color: '#64748B', fontSize: 14, breakLine: true } });
      slide.addText(content, {
        x: textX, y: BODY_TOP, w: 5.4, h: 4.8,
        fontFace: t.fontFace, lineSpacingMultiple: 1.3, valign: 'top'
      });
      return slide;
    },

    /**
     * 图表页。series: [{ name, labels: [...], values: [...] }]
     * chartType: pptxgenjs 图表类型名（bar / line / pie / radar / area / doughnut / scatter）。
     */
    addChartSlide({ title = '', series = [], chartType = 'bar', caption = '', options = {} } = {}) {
      const slide = this._addBase(title);
      const resolved = pptx.ChartType?.[chartType] ?? chartType;
      const data = (series || []).map((entry) => ({
        name: entry.name ?? '',
        labels: entry.labels ?? [],
        values: entry.values ?? []
      }));
      if (data.length > 0) {
        slide.addChart(resolved, data, {
          x: MARGIN, y: BODY_TOP, w: 11.7, h: caption ? 4.1 : 4.8,
          showLegend: data.length > 1,
          showTitle: false,
          chartColors: [t.accent, '#0EA5E9', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6'],
          catAxisLabelFontFace: t.fontFace,
          valAxisLabelFontFace: t.fontFace,
          ...options
        });
      }
      if (caption) {
        slide.addText(caption, {
          x: MARGIN, y: 5.7, w: 11.7, h: 1.0,
          fontSize: 15, color: '#475569', fontFace: t.fontFace, valign: 'top'
        });
      }
      return slide;
    },

    /** 表格页。rows: [[{ text, options } | string, ...], ...] */
    addTableSlide({ title = '', headers = [], rows = [], caption = '' } = {}) {
      const slide = this._addBase(title);
      const tableRows = [];
      if (headers.length > 0) {
        tableRows.push(headers.map((text) => ({
          text: String(text),
          options: { bold: true, color: '#FFFFFF', fill: { color: t.accent }, fontSize: 14, fontFace: t.fontFace }
        })));
      }
      for (const row of rows || []) {
        tableRows.push(row.map((cell) => {
          if (typeof cell === 'object' && cell !== null && 'text' in cell) {
            return { text: String(cell.text), options: { color: t.color, fontSize: 13, fontFace: t.fontFace, ...(cell.options || {}) } };
          }
          return { text: String(cell), options: { color: t.color, fontSize: 13, fontFace: t.fontFace } };
        }));
      }
      if (tableRows.length > 0) {
        slide.addTable(tableRows, {
          x: MARGIN, y: BODY_TOP, w: 11.7,
          border: { type: 'solid', color: '#E2E8F0', pt: 1 },
          align: 'left', valign: 'middle', autoPage: false
        });
      }
      if (caption) {
        slide.addText(caption, {
          x: MARGIN, y: 5.9, w: 11.7, h: 0.8,
          fontSize: 14, color: '#475569', fontFace: t.fontFace, valign: 'top'
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

/**
 * Apply one declarative slide specification to a deck.
 * Used by the `teacher-ppt` CLI and by Skills that emit a JSON outline.
 */
export function applySlideSpec(deck, spec = {}) {
  const kind = spec.type || spec.kind;
  switch (kind) {
    case 'title': return deck.addTitleSlide(spec);
    case 'section': return deck.addSectionSlide(spec);
    case 'concept': return deck.addConceptSlide(spec);
    case 'two-column': case 'twoColumn': return deck.addTwoColumnSlide(spec);
    case 'formula': return deck.addFormulaSlide(spec);
    case 'experiment': return deck.addExperimentSlide(spec);
    case 'exercise': case 'question': return deck.addExerciseSlide(spec);
    case 'answer': return deck.addAnswerSlide(spec);
    case 'summary': return deck.addSummarySlide(spec);
    case 'image': return deck.addImageSlide(spec);
    case 'image-text': case 'imageText': return deck.addImageTextSlide(spec);
    case 'chart': return deck.addChartSlide(spec);
    case 'table': return deck.addTableSlide(spec);
    default:
      throw new Error(`Unknown slide type: ${String(kind)}`);
  }
}

/** Build a complete teaching deck from a declarative specification. */
export async function createTeachingPresentation(spec = {}, outputPath) {
  const deck = createTeachingDeck(spec);
  const slides = spec.slides ?? [];
  if (slides.length === 0 || slides[0]?.type !== 'title') {
    deck.addTitleSlide({});
  }
  for (const slide of slides) applySlideSpec(deck, slide);
  if (outputPath) await deck.save(outputPath);
  return deck;
}

export { PptxGenJS };
export default createTeachingDeck;
