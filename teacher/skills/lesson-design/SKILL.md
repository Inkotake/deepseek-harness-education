---
name: lesson-design
description: Turn a lesson Requirement Brief into a complete, teachable lesson design. Use when the user asks for a lesson plan, a class design, a teaching sequence, a 教案, or wants a topic turned into something they can teach. Assumes the brief already exists; does not re-interview the teacher.
whenToUse: Use when the user asks for a lesson plan, 教案, class design, or teaching sequence for a topic.
user-invocable: true
disable-model-invocation: false
metadata:
  teacher-dsh:
    version: 1
---

# Lesson Design

Turn a **Requirement Brief** into a lesson the teacher can actually walk into a classroom and teach.

The brief comes from the requirement-discovery Skill, which already did the asking. Your job is not
to ask again — it is to design. If the brief leaves a low-impact slot empty, fill it with a stated
default and move on.

## What you read from the brief

| Field | How you use it |
|---|---|
| `task.topic` | the subject matter; never invent a different one |
| `audience.grade` / `subject` | vocabulary level and how much prior knowledge you may assume |
| `context.textbook` / `duration_minutes` | align to the textbook's sequencing; the duration is a hard budget |
| `goals.primary` / `secondary` | what the lesson must achieve; the primary goal decides the structure |
| `pedagogy.style` / `activity_level` | how much the students do versus how much you explain |
| `deliverable.detail` | outline versus full script |
| `assumptions` | restate these to the teacher in one line; do not bury them |
| `unresolved` | if non-empty, say what you assumed instead of asking |

## Workflow

1. **Restate the brief in one sentence.** If that sentence is wrong, the teacher can correct it
   before you spend effort on the rest. This is the only place a question is allowed, and only when
   the brief is genuinely self-contradictory.
2. **Fill low-impact gaps with defaults** and say which ones you filled. Never leave a slot silently
   empty, and never ask about one.
3. **Choose a structure that serves the primary goal** — see `references/design-patterns.md`. Pick by
   what the students should be able to do at the end, not by which pattern sounds most modern.
4. **Write the lesson** in the shape the deliverable asks for. Keep the duration budget honest: a
   45-minute lesson with 90 minutes of planned activity is a broken lesson, not an ambitious one.
5. **Self-check before handing over** — the checklist at the end of `references/design-patterns.md`.

## Boundaries

- **Do not re-interview.** Discovery belongs to the other Skill. A missing `medium_impact` slot gets
  a default, not a question.
- **Do not manage memory.** What to remember about this teacher belongs to the memory service. Do not
  write memory instructions into a lesson.
- **Do not name teaching frameworks at the teacher.** Map a plain-language goal onto a structure
  internally; the artifact the teacher reads describes what happens in the room, in their words.
- **Do not pad.** A tight 40-minute design beats a padded 45-minute one. If the goals fit in less
  time, say so and give the extra time a purpose.

## Output shape

Unless the brief asks for an outline, produce:

1. **这节课要解决什么** — one paragraph, in the teacher's language.
2. **目标** — the primary goal plus at most two secondary ones. Two to three total; more than three
   means none of them is really the goal.
3. **流程** — the sequence with minutes attached, each step naming what the teacher does and what the
   students do.
4. **关键问题** — the two or three questions that carry the lesson.
5. **可能卡住的地方** — where students typically get lost, and what to do about it.
6. **我替你定的事** — the assumptions and defaults you filled, in one short list.

See `references/design-patterns.md` for the structures and the self-check.
