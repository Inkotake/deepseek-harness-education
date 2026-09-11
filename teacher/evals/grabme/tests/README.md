# GrabMe eval runner tests

```sh
node --test "teacher/evals/grabme/tests/*.test.mjs"
```

`node --test <directory>` does not work on this Node build for a directory named
`tests`, so pass the glob (quoted, so PowerShell does not expand it).

## Files

| file | covers |
|---|---|
| `known-events.test.mjs` | the event vocabulary is the harness's, not a drifted copy |
| `load.test.mjs` | generation selection, unknown/legacy event admission, zstd |
| `slots.test.mjs` | text normalization, longest-keyword matching, the two entry index spaces |
| `questions.test.mjs` | the `Q` counting rule, answers, the repeat/TTL ledger |
| `memory.test.mjs` | preloaded/retrieved record assembly, TTL conditions, the three `bad(m)` rules |
| `metrics.test.mjs` | per-session quantities, the batch aggregate, `changed(x)` |
| `cases.test.mjs` | `cases.json` integrity, per-case assertions, both failure directions |
| `cli.test.mjs` | `runBatch` / `runScore` / report rendering end to end |

## Fixtures

`fixtures/*/session.jsonl` are **authored, not recorded**: no model produced them.
`fixtures/generate-fixtures.mjs` writes them and documents, per fixture, the exact
metric values it encodes; re-run it after editing:

```sh
node teacher/evals/grabme/tests/fixtures/generate-fixtures.mjs
```

The four fixtures are:

| fixture | case | what it exercises |
|---|---|---|
| `rich` | `missing-midterm-paper-two-questions` | all eight metrics: 5 questions, one TTL-exempt re-confirmation, one non-exempt repeat, one unclassified question, `changed` = 1/0/undecidable, artifacts in turns 3–4, memory rules 1–3 |
| `forbidden-question` | `correction-lesson-objectives-cap` | a `must_not_ask_about` violation, no artifact (`f(s) = ∞`) |
| `exceeds-first-turn` | `missing-exam-two-questions` | `max_questions_first_turn` exceeded, with no `must_not` violation |
| `direct` | `direct-execution-immediate` | `Q = 0`, `direct(s) = 1`, `f(s) = 1` |

They are minimal logical-row logs (current `version: 3` framing), written by
`JSON.stringify` rather than by the released v3 codec, because that codec lives in
TypeScript under `deepseek-harness/packages/` and this suite must not depend on a
built harness checkout. They therefore prove the runner's counting rules, not that
the DSH codec accepts these bytes.
