# Changelog

## 0.3.0

- **Hybrid architecture**: skills registered as both MCP tools (111 total: 107 skills + 4 meta) and MCP prompts (107). Tools work in Claude.ai and future orchestrators. Prompts ready for Claude Desktop and clients that surface them.
- Skill tool results use instruction framing so the calling Claude model executes the skill rather than displaying the raw prompt.
- Optional `{{placeholder}}` parameters that aren't provided are replaced with `[not provided]` instead of appearing as raw template syntax.

## 0.2.0

- Moved 107 skills from tools to MCP prompts. Kept 4 meta-tools (list_skills, get_skill_details, find_skills, suggest_skills). Reverted in v0.3.0 because Claude.ai doesn't surface MCP prompts in its UI.

## 0.1.0

- Initial release. 111 MCP tools (107 skills + 4 meta-tools) over stdio transport.
- Vercel deployment with streamable HTTP transport, stateless JSON response mode.
- Skill loader parses YAML frontmatter from parent repo markdown files at startup.
- `SKILLS_FILTER` env var for limiting loaded domains.
- Playwright test suite: 9 tests covering startup, domain grouping, skill suggestions, prompt assembly, input validation, name collisions, and domain filtering.
