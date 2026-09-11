/**
 * Slot attribution: normalization, longest-keyword-wins, the two-direction entry
 * index spaces, confirmation phrasing, and value extraction.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  attributeQuestion,
  extractSlotValue,
  isConfirmingQuestion,
  matchSlots,
  normalizeText,
  resolveCaseEntry,
} from '../lib/slots.mjs'

test('normalizeText applies NFKC and removes whitespace', () => {
  assert.equal(normalizeText('  高 一 ？ '), '高一?')
  assert.equal(normalizeText('ＡＢＣ'), 'abc')
  assert.equal(normalizeText(undefined), '')
})

test('matchSlots reports every hit and puts the longest keyword first', () => {
  const matched = matchSlots('这学期的复习范围是什么？')
  assert.ok(matched.slots.includes('review_scope'))
  assert.equal(matched.matches[0].slot, 'review_scope')
  assert.equal(matched.matches[0].keyword, '复习范围')
})

test('matchSlots returns nothing for text outside the vocabulary', () => {
  assert.deepEqual(matchSlots('还需要再出一套变式题吗').slots, [])
})

test('resolveCaseEntry resolves a slot name into canonical slots', () => {
  const entry = resolveCaseEntry('年级与学科')
  assert.deepEqual(entry.slots, ['grade', 'subject'])
  assert.equal(entry.literal, '年级与学科')
})

test('resolveCaseEntry keeps an unmatched phrasing as a literal', () => {
  const entry = resolveCaseEntry('请描述你想要的创新点')
  assert.deepEqual(entry.slots, ['novelty_direction'])
  assert.equal(entry.entry, '请描述你想要的创新点')
})

test('attributeQuestion keeps must_ask and must_not index spaces separate', () => {
  // Regression guard: a shared index space let a `must_ask_about` hit satisfy a
  // `must_not_ask_about` entry, reporting the right question as the forbidden one.
  const mustAskEntries = [resolveCaseEntry('年级'), resolveCaseEntry('考试范围')]
  const mustNotEntries = [resolveCaseEntry('分值'), resolveCaseEntry('难度梯度')]
  const attribution = attributeQuestion('这是哪个年级的卷子？', { mustAskEntries, mustNotEntries })
  assert.deepEqual(attribution.mustAskEntries, [0])
  assert.deepEqual(attribution.mustNotEntries, [])
  assert.equal(attribution.primary, 'grade')
})

test('attributeQuestion matches a literal phrasing exactly', () => {
  const mustNotEntries = [resolveCaseEntry('您希望什么形式')]
  const attribution = attributeQuestion('那您希望什么形式的课堂活动呢？', { mustNotEntries })
  assert.deepEqual(attribution.mustNotEntries, [0])
  assert.equal(attribution.primary, 'open_ended_form_request')
})

test('attributeQuestion reports an unmatched question as having no primary slot', () => {
  const attribution = attributeQuestion('还需要再出一套变式题吗')
  assert.equal(attribution.primary, null)
  assert.deepEqual(attribution.canonical, [])
})

test('isConfirmingQuestion separates re-confirmation from interrogation', () => {
  assert.equal(isConfirmingQuestion('今年还是高一吗？'), true)
  assert.equal(isConfirmingQuestion('这学期带哪个年级？'), false)
  assert.equal(isConfirmingQuestion('教材版本有变化吗？'), false)
})

test('extractSlotValue reads only closed value forms', () => {
  assert.equal(extractSlotValue('lesson_minutes', '一节课的时长改成 40 分钟'), '40')
  assert.equal(extractSlotValue('grade', '这学期带高二'), '高二')
  assert.equal(extractSlotValue('textbook', '还是人教版'), '人教版')
  assert.equal(extractSlotValue('subject', '学科还是高中地理吧？'), undefined)
})
