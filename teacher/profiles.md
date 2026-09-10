# Teacher DSH Profiles

Two profiles ship in Teacher DSH 0.1.0:

## `desktop`

Kept exactly as upstream anywhere-labs/dsh-desktop v2.0.5. This is the
safe/recovery profile. If a teacher installation misbehaves, switch to
`desktop` to determine whether the problem is in DSH Desktop or the
Teacher Pack.

## `teacher` (default)

Starts from the normal Desktop composition and adds:

- Teacher DSH bundle (`@teacher-dsh/teacher-bundle`)
- Bundled teacher skills (teaching-aid, publish-static, latex-authoring)
- Vendored education skills (7 selected from Education Agent Skills, CC BY-SA 4.0)
- PPTKit Presentation
- DSH Better Sidebar
- DSH Cowork

Default launch profile is `teacher`.