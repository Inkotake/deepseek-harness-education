---
name: teaching-slides
description: Generate a real editable PowerPoint (.pptx) teaching presentation with PptxGenJS and @teacher-dsh/ppt-kit. Use when the user asks for a PPT, 课件, slides, or teaching presentation based on a topic or document.
---

# Teaching Slides

## Goal

Generate a real `.pptx` file (not images) with a consistent teaching layout.

## Workflow

1. Read or infer the source material (README.md, textbook section, topic).
2. Plan slide structure: title slide, section slides, concept slides, experiment slides, question slides, summary slide.
3. Write a Node script using `@teacher-dsh/ppt-kit`.
4. Run the script with Node.
5. Deliver the `.pptx` file.

## API

```js
import { createTeachingDeck } from '@teacher-dsh/ppt-kit';

const deck = createTeachingDeck({ title: '牛顿第二定律', subtitle: '高一物理' });

deck.addConceptSlide({
  title: '牛顿第二定律',
  points: ['物体的加速度与合外力成正比', '与质量成反比'],
  formula: 'F = ma'
});

deck.addExperimentSlide({
  title: '实验：探究加速度与力、质量的关系',
  goal: '控制变量法',
  steps: ['安装打点计时器', '平衡摩擦力', '改变砝码质量记录纸带'],
  conclusion: 'a ∝ F，a ∝ 1/m'
});

deck.addQuestionSlide({
  title: '课堂练习',
  questions: [
    { text: '关于 F=ma，下列说法正确的是？', options: ['...'], answer: 'A' }
  ]
});

await deck.save('牛顿第二定律.pptx');
```

## Layout rules

- Default ratio 16:9.
- Theme fonts: Microsoft YaHei.
- Body font size >= 16px, titles >= 30px.
- Every slide has a footer with deck title and page number.
- Use section slides for transitions between parts.
- Do NOT generate random per-slide styles; always use the deck helpers.

## Completion

- The script runs without error.
- The `.pptx` file opens in PowerPoint/WPS.
- It is editable (real text boxes, not screenshots).