@AGENTS.md

## Claude Code specifics
- Preview the site with the `trippo-dev` launch config (`.claude/launch.json`, port 8080).
- The Telegram bot's `/claude <request>` runs `claude -p --permission-mode acceptEdits` in this
  folder: edits are auto-accepted, shell commands are not, and nothing deploys until `/deploy`.
