---
name: ppt-design
description: Turn a lesson or a Requirement Brief into a slide deck a teacher can present from. Use when the user asks for slides, a deck, 课件, a presentation, or wants a lesson turned into something to project. Produces the deck plan and, when the runtime is available, the PPTX itself.
whenToUse: Use when the user asks for slides, 课件, a PPT, a deck, or a presentation for a class.
user-invocable: true
disable-model-invocation: false
metadata:
  teacher-dsh:
    version: 1
---

# PPT Design

Produce slides a teacher presents **from**, not slides they read aloud. The deck supports the
lesson; it is not the lesson.

## The one rule that matters most

**A slide is a picture with a caption, not a page of prose.** Teachers consistently report that the
deck they were given is unusable because every slide is a paragraph. Treat word density as a hard
budget, not a style preference — see `references/slide-patterns.md` for the numbers.

If you cannot fit a slide's content into the budget, that is a signal the slide is doing two jobs:
split it, or move the detail into the teacher's notes and keep the slide as the visual.

## What you read from the brief

| Field | How you use it |
|---|---|
| `task.topic` | the deck's subject |
| `audience.grade` | vocabulary, and how much text the students can read at projection distance |
| `context.duration_minutes` | how many slides; roughly one slide per 1.5–2 minutes, fewer for discussion-heavy lessons |
| `goals.primary` | the deck's spine — every slide should serve it |
| `pedagogy.activity_level` | how many activity/discussion slides you insert |
| `assumptions` | restate in one line |

## Workflow

1. **Restate the brief in one sentence** so the teacher can correct it before you build.
2. **Write the spine first**: the sequence of ideas, one line each, before any slide exists. If the
   spine does not hang together, no amount of slide design will fix it.
3. **Turn each spine line into a slide** using `references/slide-patterns.md`, respecting the density
   budget and choosing the layout by what the idea *is* — a comparison, a process, a single number, a
   photograph, a question.
4. **Add the teacher's notes** for the detail that does not belong on the slide. This is where the
   paragraphs go.
5. **Self-check**: the density budget, and the check that the deck can be presented with the screen
   off and still make sense as a sequence.

## Output

- The **spine** as a short list, so the teacher can reorganise before you render anything.
- The **slide plan**: one block per slide with its title, its content as it will appear, the layout,
  and the teacher's notes.
- The **file** when the runtime provides it: build the deck with `teacher-ppt` and hand back the
  `.pptx`. If the runtime is unavailable, say so and deliver the plan instead — never claim a file
  exists that does not.

## Boundaries

- Do not re-interview; discovery belongs to the requirement step. Fill gaps with stated defaults.
- Do not manage memory.
- Do not put a slide's content into the teacher's notes and call the slide done — notes support the
  slide, they do not replace what the students must see.
- Do not use a template's decorative stock imagery as if it carried meaning.

See `references/slide-patterns.md` for the layouts, the density numbers, and the self-check.
