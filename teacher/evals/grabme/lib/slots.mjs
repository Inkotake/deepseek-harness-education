/**
 * Slot vocabulary and question-text normalization.
 *
 * `metrics.md` requires every counted question to be attributed to a slot:
 * "把该问题的文本归一化（去空白、全角转半角），与 cases.json 中该 case 的槽位名表
 * （must_ask_about ∪ must_not_ask_about ∪ notes 里显式列出的槽位）做同义匹配；匹配到唯一
 * 槽位即归属该槽位；匹配不到任何槽位记为 unclassified，unclassified 单独列出但不从 Q 中剔除".
 *
 * Two layers implement that:
 *
 * 1. {@link SLOT_DEFINITIONS} — the canonical slot vocabulary. Each entry is
 *    `[key, label, keywords, valueExtractor?]`. Keywords are matched with
 *    `String.prototype.includes` against NFKC-normalized, whitespace-stripped text.
 * 2. Case-entry resolution — each `must_ask_about` / `must_not_ask_about` string
 *    from `cases.json` is matched against the same vocabulary. An entry that
 *    resolves becomes a *group* of canonical slots; an entry that resolves to
 *    nothing (e.g. `您希望什么形式`) stays a *literal* entry matched by its own text.
 *
 * Longest-keyword-wins makes attribution deterministic when several slots match
 * (e.g. `复习范围` beats `范围`). This table is authored content, not derived: it
 * is the synonym table the README lists as a runner requirement.
 *
 * @module grabme/lib/slots.mjs
 */

/**
 * Canonical slots, in declaration order. Declaration order breaks ties, so an
 * earlier entry wins when two slots match keywords of equal length.
 *
 * @type {ReadonlyArray<readonly [string, string, readonly string[]]>}
 */
export const SLOT_DEFINITIONS = Object.freeze([
  ['grade', '年级', ['年级', '高几', '初几', '几年级', '高一', '高二', '高三', '七年级', '八年级', '九年级', '初一', '初二', '初三']],
  ['subject', '学科', ['学科', '哪一科', '哪个学科', '什么科目', '教哪一科', '任教科目']],
  ['textbook', '教材版本', ['教材版本', '哪本教材', '什么教材', '哪个版本', '用的教材', '人教版', '苏教版', '北师大版', '沪教版', '湘教版', '鲁教版', '外研版', '粤教版', '中图版']],
  ['lesson_minutes', '课时长度', ['课时长度', '课时安排', '一节课多长', '上课时长', '一节课的时长', '课时是', '课时多长', '一节课多少分钟']],
  ['topic', '课题', ['课题', '讲哪一课', '哪一课', '上哪一节', '课文标题', '讲课内容', '讲的是哪', '准备讲什么']],
  ['teaching_focus', '教学侧重', ['教学侧重', '侧重点', '侧重在', '重讲授', '重观察', '重实验', '重生活应用', '偏重', '教学重点放在', '教学取向']],
  ['assessment_scope', '考试范围', ['考试范围', '考到哪里', '考到哪', '考查范围', '考哪些内容', '考试内容', '考试的范围', '范围是', '考的范围']],
  ['next_week_scope', '下周几节课与进度起点', ['下周几节', '几节课', '进度起点', '从哪里讲起', '讲到哪里了', '下周的课', '这学期的进度', '几节地理课']],
  ['chapter', '对应章节', ['章节', '哪一章', '对应章节', '哪一节内容']],
  ['starting_part', '先做哪一部分', ['先做哪一部分', '先做哪一块', '从哪开始', '先做哪个', '优先做哪', '从哪里开始', '先做第几章']],
  ['score_points', '分值', ['分值', '多少分', '满分', '每题几分', '分数怎么']],
  ['difficulty', '难度梯度', ['难度梯度', '难度', '难易', '难一点还是']],
  ['question_type_ratio', '题型比例', ['题型比例', '题型', '题目类型', '题型分布']],
  ['paper_structure', '试卷结构', ['试卷结构', '卷子结构', '试卷的组成', '几道大题']],
  ['exam_duration', '考试时长', ['考试时长', '考多久', '考试多长时间', '考试时间']],
  ['item_count', '题量', ['题量', '多少题', '几道题', '题目数量']],
  ['novelty_direction', '新颖的形式', ['新颖', '创新点', '什么算新颖', '有创意']],
  ['open_ended_form_request', '开放式形式询问', ['您希望什么形式', '你希望什么形式', '您想要哪种', '请再选一个', '您希望什么风格', '您想要什么类型的活动', '你希望什么形式的活动', '要梳理成什么形式', '希望怎么复习', '您希望怎么复习', '您希望什么', '您想要什么']],
  ['classroom_form', '课堂形式', ['课堂形式', '活动形式', '课堂活动', '活动类型', '什么类型的活动']],
  ['delivery_form', '交付形式', ['交付形式', '交付格式', '什么格式', '以什么形式给']],
  ['weekly_lessons', '每周几节', ['每周几节', '一周几节', '每周几节课']],
  ['material_types', '要准备什么形式的材料', ['什么形式的材料', '哪些类型的材料', '每节课都要吗', '准备哪些材料']],
  ['style_keywords', '风格形容词', ['清爽', '风格是', '什么风格', '更清爽指', '清爽指什么']],
  ['font_size', '字号', ['字号', '字体大小', '字大', '字小', '字少']],
  ['color_scheme', '配色', ['配色', '颜色', '色调']],
  ['page_count', '页数', ['页数', '多少页', '几页']],
  ['template_style', '模板风格', ['模板风格', '模板', '用什么模板']],
  ['animation', '是否放动画', ['动画']],
  ['image_assets', '有没有图片素材', ['图片素材', '配图', '有没有图']],
  ['answer_key', '答案编排', ['附答案', '答案放哪', '答案和题目', '答案单独', '要不要答案', '答案是否分开', '答案怎么放', '答案要', '答案']],
  ['answer_sheet', '要不要答题卡', ['答题卡']],
  ['complete_time', '完成时间', ['完成时间', '多久做完', '多长时间完成', '几分钟做完']],
  ['book_list_topic', '书单主题', ['书单主题', '书单', '书目']],
  ['reading_difficulty', '阅读难度', ['阅读难度', '阅读水平', '阅读能力']],
  ['grading_criteria', '批改标准', ['批改标准', '怎么批改', '评分标准']],
  ['city', '哪个市', ['哪个市', '哪个城市', '哪个地区', '哪个省']],
  ['schools', '哪些学校', ['哪些学校', '哪几所学校']],
  ['ranking_dimension', '排名维度', ['排名维度', '按什么排名', '排名依据']],
  ['data_caliber', '数据口径', ['数据口径', '数据来源', '口径']],
  ['unit', '哪个单元', ['哪个单元', '第几单元', '单元是']],
  ['review_scope', '复习范围', ['复习范围', '复习到哪', '复习哪些', '复习内容']],
  ['review_form', '复习形式', ['复习形式', '怎么复习', '复习方式', '复习课的形式']],
  ['practice_or_not', '要不要做题', ['要不要做题', '做不做题', '要练题吗']],
  ['segment_count', '环节数量', ['删掉哪个环节', '保留几个环节', '几个环节', '环节太多', '环节数量', '删掉哪些环节']],
  ['in_class_practice', '当堂练习', ['当堂练习', '课堂练习', '课上练习', '留练习']],
  ['longterm_activity_pref', '是否长期不要课堂活动', ['一直不喜欢', '以后都不要课堂活动', '长期偏好', '要不要存成长期', '长期记住']],
  ['class_progress_memory', '是否记住这个班进度', ['记住这个班', '这个班以后', '所有班都讲慢', '班都讲慢']],
  ['calculation_pref', '是否长期不要计算题', ['以后都不要计算题', '记住这个偏好', '以后都不要']],
  ['class_difference', '班级差异', ['有什么不同', '基础怎么样', '区别对待', '两个班', '班级差异', '班的差别', '3班', '1班', '3 班', '1 班']],
  ['example_replacement', '换哪个案例', ['哪个例子', '换成什么案例', '教材上哪个例子', '用哪个案例', '换哪个案例', '例子代替']],
  ['grouping', '要不要分组', ['分组', '分几组', '小组']],
  ['activity_goal', '活动目标', ['活动目标', '活动的目标', '目标是什么']],
  ['activity_duration', '活动时长', ['多长时间', '活动时长', '花多久']],
  ['learning_goal_count', '教学目标数量', ['教学目标写几项', '教学目标数量', '希望几个目标', '几个教学目标', '目标控制在', '教学目标']],
  ['misunderstanding', '什么是没听懂', ['什么是没听懂', '哪里没听懂', '没听懂', '听不懂什么']],
  ['curriculum_standard', '课标口径', ['课程标准', '课标']],
  ['class_style', '班级学情', ['学生基础', '基础一般', '基础差', '基础好', '班基础', '学情']],
])

/** Canonical slot keys, in declaration order. */
export const SLOT_KEYS = Object.freeze(SLOT_DEFINITIONS.map(entry => entry[0]))

/** Canonical slot key → Chinese label. */
export const SLOT_LABELS = Object.freeze(
  Object.fromEntries(SLOT_DEFINITIONS.map(entry => [entry[0], entry[1]])),
)

/** Keyword → canonical slot key, for the longest-match rule. */
const KEYWORD_INDEX = (() => {
  const index = new Map()
  for (const [key, , keywords] of SLOT_DEFINITIONS) {
    for (const keyword of keywords) {
      const normalized = normalizeText(keyword)
      if (!index.has(normalized)) index.set(normalized, key)
    }
  }
  return index
})()

/**
 * Normalize text for slot matching: NFKC (full-width to half-width), lowercase,
 * and all whitespace removed. Punctuation is kept, because question marks and
 * clause separators are meaningful to the sentence splitter in `questions.mjs`.
 *
 * @param value - any value; non-strings are coerced with `String`.
 * @returns the normalized text.
 */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, '')
}

/**
 * Match one normalized text against the canonical slot vocabulary.
 *
 * @param text - raw text; normalization is applied here.
 * @returns `{ slots, matches }` where `slots` lists matched keys in
 *   longest-keyword-first order (ties broken by declaration order) and `matches`
 *   lists `{ slot, keyword, length }` for every hit.
 */
export function matchSlots(text) {
  const normalized = normalizeText(text)
  const matches = []
  for (const [keyword, slot] of KEYWORD_INDEX) {
    if (keyword.length === 0) continue
    if (!normalized.includes(keyword)) continue
    matches.push({ slot, keyword, length: keyword.length })
  }
  matches.sort((left, right) => {
    if (right.length !== left.length) return right.length - left.length
    return SLOT_KEYS.indexOf(left.slot) - SLOT_KEYS.indexOf(right.slot)
  })
  const slots = []
  for (const match of matches) if (!slots.includes(match.slot)) slots.push(match.slot)
  return { slots, matches }
}

/**
 * Resolve one `cases.json` slot string into the canonical slots it names.
 *
 * @param entry - a `must_ask_about` / `must_not_ask_about` string from a case.
 * @returns `{ entry, text, slots, literal }`: `slots` are the canonical keys the
 *   entry names (empty when it names none) and `literal` is the normalized entry
 *   text, always usable as an additional exact-substring pattern.
 */
export function resolveCaseEntry(entry) {
  const text = normalizeText(entry)
  const { slots } = matchSlots(entry)
  return { entry, text, slots, literal: text }
}

/**
 * Attribute one question to slots, using both the canonical vocabulary and a
 * case's resolved entry table.
 *
 * @param questionText - the question as it appears in the log.
 * @param caseEntries - resolved entries from {@link resolveCaseEntry}, or `[]`.
 * @returns `{ canonical, entries, primary, literalMatched }`:
 *   `canonical` is every matched canonical key, `entries` the indices of matched
 *   case entries, `primary` the single slot identity used for repeat detection
 *   (`null` when nothing matched, which the report renders as `unclassified`),
 *   and `literalMatched` the entry texts matched by exact substring.
 */
export function attributeQuestion(questionText, caseEntries) {
  const { slots, matches } = matchSlots(questionText)
  const normalized = normalizeText(questionText)
  const entries = []
  const literalMatched = []
  for (let index = 0; index < caseEntries.length; index += 1) {
    const entry = caseEntries[index]
    const literalHit = entry.literal.length >= 2 && normalized.includes(entry.literal)
    const slotHit = entry.slots.some(slot => slots.includes(slot))
    if (literalHit || slotHit) {
      entries.push(index)
      if (literalHit) literalMatched.push(entry.entry)
    }
  }
  const literalOnly = [...literalMatched].sort((a, b) => normalizeText(b).length - normalizeText(a).length)[0]
  const primary = matches.length > 0
    ? matches[0].slot
    : literalOnly === undefined ? null : `literal:${literalOnly}`
  return { canonical: slots, entries, primary, literalMatched }
}

/**
 * Extract the explicit value a user message states for one slot.
 *
 * This is the only place the runner reads a *value* out of human text, and it
 * exists for one narrow purpose: deciding whether a memory record conflicts with
 * the user's current explicit expression (`metrics.md` §6, first bullet). Only
 * slots with a closed, checkable value form have an extractor; everything else
 * returns `undefined`, which the memory metric reports as `undetermined` rather
 * than silently counting as "no conflict".
 *
 * @param slot - a canonical slot key.
 * @param text - the user message text.
 * @returns the stated value as a string, or `undefined` when this slot has no extractor or none matched.
 */
export function extractSlotValue(slot, text) {
  const normalized = normalizeText(text)
  switch (slot) {
    case 'lesson_minutes':
      return firstMatch(normalized, /(\d+)(?:分钟|min)/u)
    case 'weekly_lessons':
      return firstMatch(normalized, /(\d+)(?:节|节课)/u)
    case 'score_points':
      return firstMatch(normalized, /(\d+)(?:分|分制)/u)
    case 'item_count':
      return firstMatch(normalized, /(\d+)(?:题|道题)/u)
    case 'page_count':
      return firstMatch(normalized, /(\d+)(?:页)/u)
    case 'grade':
      return firstMatch(normalized, /(高一|高二|高三|初一|初二|初三|七年级|八年级|九年级)/u)
    case 'textbook':
      return firstMatch(normalized, /(人教版|苏教版|北师大版|沪教版|湘教版|鲁教版|外研版|粤教版|中图版)/u)
    default:
      return undefined
  }
}

/** Return capture group 1 of the first match, or `undefined`. */
function firstMatch(text, pattern) {
  const match = pattern.exec(text)
  return match === null ? undefined : match[1]
}

/**
 * Whether a question reads as a confirmation of a known value rather than an
 * interrogation of an unknown one.
 *
 * This is condition (b) of the `metrics.md` §2 TTL exemption. The check is
 * textual on purpose: the exemption may only apply to questions phrased as
 * re-confirmations (`今年还是高一吗？`), never to open questions about the same slot.
 *
 * @param questionText - the question as it appears in the log.
 * @returns true when the text carries a re-confirmation marker and a question particle.
 */
export function isConfirmingQuestion(questionText) {
  const normalized = normalizeText(questionText)
  const confirms = /(还是|仍然|依然|是否)/u.test(normalized)
  const asks = /[吗呢]/u.test(normalized)
  return confirms && asks
}
