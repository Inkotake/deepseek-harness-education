#!/usr/bin/env node
/**
 * teacher-ppt - Teacher DSH presentation CLI.
 *
 * Builds real, editable OOXML `.pptx` files from a declarative deck spec:
 *
 *   teacher-ppt init deck.json
 *   teacher-ppt build deck.json --out 牛顿第二定律.pptx
 *   teacher-ppt check 牛顿第二定律.pptx
 *
 * The deck spec is a JSON document:
 *
 *   {
 *     "title": "牛顿第二定律",
 *     "subtitle": "高一物理",
 *     "subject": "物理",
 *     "theme": "modern",
 *     "slides": [
 *       { "type": "title" },
 *       { "type": "concept", "title": "定律", "points": ["..."], "formula": "F = ma" }
 *     ]
 *   }
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { applySlideSpec, createTeachingDeck, TEACHING_THEMES } from '../src/index.js';

const USAGE = `
teacher-ppt - Teacher DSH presentation CLI

Usage:
  teacher-ppt init [spec.json]            Write an example deck spec
  teacher-ppt build <spec.json> [--out <file.pptx>]
  teacher-ppt build - [--out <file.pptx>]  Read the spec from stdin
  teacher-ppt check <file.pptx>           Validate a generated .pptx
  teacher-ppt types                       List supported slide types
  teacher-ppt help

Slide types:
  title, section, concept, two-column, formula, experiment, exercise,
  answer, summary, image, image-text, chart, table
`;

const EXAMPLE_SPEC = {
  title: '牛顿第二定律',
  subtitle: '高一物理 · 人教版必修一',
  subject: '物理',
  theme: 'modern',
  slides: [
    { type: 'title', date: '' },
    { type: 'section', section: '一、定律的表述', hint: '从实验现象到数学表达' },
    {
      type: 'concept',
      title: '牛顿第二定律',
      points: [
        '物体加速度的大小跟作用力成正比',
        '跟物体的质量成反比',
        '加速度的方向跟作用力的方向相同'
      ],
      formula: 'F = ma',
      note: '国际单位制中，力的单位是牛顿（N），1 N = 1 kg·m/s²。'
    },
    {
      type: 'two-column',
      title: '理解要点',
      leftTitle: '成立条件',
      leftPoints: ['惯性参考系', '质量保持不变', '宏观低速运动'],
      rightTitle: '常见误区',
      rightPoints: ['把 F 当成合力以外的某一个力', '认为 a 与 F 同时产生但方向无关'],
      formula: 'F_{合} = ma'
    },
    { type: 'formula', title: '变形与推导', formulas: [
      { latex: 'a = F / m', caption: '已知力与质量' },
      { latex: 'm = F / a', caption: '已知力与加速度' },
      { latex: 'F = m \\cdot \\Delta v / \\Delta t', caption: '由加速度定义式代入' }
    ] },
    {
      type: 'experiment',
      title: '实验：探究加速度与力、质量的关系',
      goal: '验证 a 与 F 成正比、与 m 成反比',
      steps: ['平衡摩擦力', '保持质量不变，改变拉力，测加速度', '保持拉力不变，改变质量，测加速度', '作 a-F 图与 a-1/m 图'],
      conclusion: 'a-F 图线为过原点的直线，a-1/m 图线同样为直线'
    },
    {
      type: 'chart',
      chartType: 'line',
      title: '实验数据：a 与 F 的关系',
      series: [{ name: 'a (m/s²)', labels: ['0.5', '1.0', '1.5', '2.0', '2.5'], values: [0.5, 1.0, 1.5, 2.0, 2.5] }],
      caption: '在质量 m 一定的条件下，a 与 F 成正比。'
    },
    {
      type: 'table',
      title: '数据记录表',
      headers: ['F / N', 'm / kg', 'a / (m·s⁻²)'],
      rows: [['0.5', '1.0', '0.50'], ['1.0', '1.0', '1.00'], ['1.5', '1.0', '1.50']],
      caption: '由表可见，m 不变时 a 与 F 的比值恒定。'
    },
    {
      type: 'exercise',
      title: '课堂练习',
      questions: [
        { text: '质量 2 kg 的物体受到 6 N 的合外力，加速度是多少？', options: ['1 m/s²', '3 m/s²', '12 m/s²', '0.33 m/s²'] },
        { text: '物体做匀速直线运动时，合外力为多少？', options: ['等于重力', '等于摩擦力', '为零', '无法判断'] }
      ]
    },
    { type: 'answer', title: '参考答案', answers: [
      { text: 'B', reason: 'a = F/m = 6/2 = 3 m/s²' },
      { text: 'C', reason: '匀速直线运动即 a = 0，故合外力为零' }
    ] },
    { type: 'summary', title: '本节小结', points: ['F = ma 是矢量式', 'a 的方向由合外力决定', '适用于惯性参考系、宏观低速'], homework: '课本 P78 第 2、4 题' }
  ]
};

function log(message) {
  process.stdout.write(message + '\n');
}

function fail(message) {
  process.stderr.write('[teacher-ppt] ERROR ' + message + '\n');
  process.exitCode = 1;
}

function readSpec(file) {
  const raw = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(file), 'utf8');
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new Error(`Invalid deck spec JSON in ${file}: ${cause.message}`);
  }
}

async function cmdInit(args) {
  const target = path.resolve(args[0] || 'deck.json');
  if (fs.existsSync(target)) throw new Error(`File already exists: ${target}`);
  fs.writeFileSync(target, JSON.stringify(EXAMPLE_SPEC, null, 2) + '\n');
  log('Wrote deck spec: ' + target);
  log('Next: teacher-ppt build ' + path.basename(target) + ' --out 教学课件.pptx');
  return 0;
}

async function cmdBuild(args) {
  const specFile = args.find((a) => !a.startsWith('-'));
  if (!specFile) throw new Error('Usage: teacher-ppt build <spec.json> [--out <file.pptx>]');
  const outIndex = args.indexOf('--out');
  const spec = readSpec(specFile);
  const deckTitle = spec.title || '教学课件';
  const outArg = outIndex >= 0 ? args[outIndex + 1] : undefined;
  const out = path.resolve(outArg || `${deckTitle}.pptx`);
  if (!out.toLowerCase().endsWith('.pptx')) throw new Error(`Output must end in .pptx: ${out}`);
  if (!TEACHING_THEMES[spec.theme || 'modern']) throw new Error(`Unknown theme: ${spec.theme}`);

  const deck = createTeachingDeck(spec);
  const slides = Array.isArray(spec.slides) ? spec.slides : [];
  if (slides.length === 0 || slides[0].type !== 'title') deck.addTitleSlide({});
  for (const slide of slides) applySlideSpec(deck, slide);

  await deck.save(out);
  const size = fs.statSync(out).size;
  log(`Wrote ${out} (${(size / 1024).toFixed(1)} KB, ${deck.slideCount} slides)`);
  return 0;
}

/** Minimal OOXML structural validation without external dependencies. */
async function cmdCheck(args) {
  const target = path.resolve(args.find((a) => !a.startsWith('-')) || '');
  if (!target || !fs.existsSync(target)) throw new Error('Usage: teacher-ppt check <file.pptx>');
  const { execFileSync } = await import('node:child_process');
  const listing = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; `
    + `$z=[System.IO.Compression.ZipFile]::OpenRead('${target.replaceAll("'", "''")}'); `
    + `$z.Entries | ForEach-Object { $_.FullName }; $z.Dispose()`
  ], { encoding: 'utf8' });
  const entries = listing.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const required = ['[Content_Types].xml', 'ppt/presentation.xml', '_rels/.rels'];
  const missing = required.filter((entry) => !entries.includes(entry));
  const slideCount = entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/u.test(entry)).length;
  if (missing.length > 0) {
    fail(`invalid .pptx: missing ${missing.join(', ')}`);
    return 1;
  }
  if (slideCount === 0) {
    fail('invalid .pptx: no slides found');
    return 1;
  }
  log(`OK ${target}`);
  log(`  slides: ${slideCount}`);
  log(`  parts:  ${entries.length}`);
  log('  editable OOXML: yes');
  return 0;
}

function cmdTypes() {
  for (const theme of Object.keys(TEACHING_THEMES)) log('theme: ' + theme);
  log('slide types: title, section, concept, two-column, formula, experiment, exercise, answer, summary, image, image-text, chart, table');
  return 0;
}

async function main() {
  const [, , command, ...args] = process.argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return;
  }
  switch (command) {
    case 'init': process.exitCode = await cmdInit(args); break;
    case 'build': process.exitCode = await cmdBuild(args); break;
    case 'check': process.exitCode = await cmdCheck(args); break;
    case 'types': process.exitCode = cmdTypes(); break;
    default:
      fail(`Unknown command: ${command}`);
      process.stdout.write(USAGE);
  }
}

main().catch((cause) => {
  fail(cause instanceof Error ? cause.message : String(cause));
});
