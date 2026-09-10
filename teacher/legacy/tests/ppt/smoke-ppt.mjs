import { createTeachingDeck } from '../../packages/ppt-kit/src/index.js';
import fs from 'node:fs';
import path from 'node:path';

const out = path.join(process.cwd(), 'teacher-dsh-smoke.pptx');
const deck = createTeachingDeck({ title: '牛顿第二定律', subtitle: '高一物理', subject: '物理' });
deck.addTitleSlide();
deck.addSectionSlide({ section: '一、知识回顾', hint: '力的合成与分解' });
deck.addConceptSlide({ title: '牛顿第二定律', points: ['物体的加速度与合外力成正比', '与质量成反比', '公式：F = ma'], formula: 'F = ma' });
deck.addExperimentSlide({ title: '实验：探究加速度与力、质量的关系', goal: '使用控制变量法', steps: ['平衡摩擦力', '保持质量不变，改变拉力', '保持拉力不变，改变质量'], conclusion: 'a ∝ F，a ∝ 1/m' });
deck.addQuestionSlide({ title: '课堂练习', questions: [{ text: '关于 F=ma，下列说法正确的是？', options: ['A. 加速度由合外力决定', 'B. 质量越大加速度越大', 'C. 力与加速度无关'], answer: 'A' }] });
deck.addSummarySlide({ title: '本节小结', points: ['F = ma', '控制变量法', '加速度与合外力成正比'] });

const saved = await deck.save(out);
if (!fs.existsSync(saved)) {
  console.error('PPT file was not created');
  process.exit(1);
}
console.log('PPT smoke OK:', saved, (fs.statSync(saved).size / 1024).toFixed(1) + ' KB');