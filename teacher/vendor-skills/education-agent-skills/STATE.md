# State — Education Agent Skills Library

## Last updated: 2026-05-27

## What was done this session

Built and shipped Domain 20: Student-Facing Learning Skills — 13 new skills in a new domain `student-learning`.

All 13 skills: retrieve-first-gate, explain-first-interrogator, progressive-hint-ladder, confidence-calibration-check, stuck-and-error-diagnosis-coach, ai-claim-checker, transfer-bridge, teach-back-evaluator, productive-failure-protocol, srl-session-wrapper, unassisted-evidence-checkpoint, weekly-agency-review, fading-manager.

## What was verified

- All 20 Playwright tests pass (was 18 before, 2 new skills-library tests were already in suite)
- registry.json regenerated: 165 skills, 20 domains
- mcp-server/src/skills.json rebundled: 165 skills
- Committed and pushed: d84b8f4

## Current library state

- 165 skills across 20 domains
- Domain 20 is new and different from Domains 1–19: student-facing live interaction patterns, not educator-facing artefact generation
- Domain 20 introduces `evidence_captured` YAML schema extension for structured learning evidence
- `generate-registry.py` updated with "student-learning" in DOMAIN_LABELS

## What's next

- Downstream: Kaku's Tutor Agent and Hippo can now reference Domain 20 skills
- Consider building a cross-domain orchestrator skill that chains Domain 20 skills (e.g., 20-01 → 20-04 → 20-11 sequence)
- QA evaluator session (separate Claude invocation) recommended before production use of Domain 20 skills
