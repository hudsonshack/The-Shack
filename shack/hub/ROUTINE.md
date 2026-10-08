# Routine start-up (read first)

The Routine "The Shack Operations" runs this at 05:45, 15:45 and 20:45 America/New_York. The repo owner set it up and pre-authorized everything below: committing and pushing to the branch `ops/state`, creating Google Calendar study blocks, scheduling Metricool posts, creating Gmail drafts, reading and updating the quest board database of the world artifact, and republishing the world artifact named in `shack/config.json` → `world.artifact_url`.

1. Bootstrap the branch:
   - `git fetch origin`
   - BASE = `origin/main` if `git cat-file -e origin/main:shack/hub/DIRECTOR.md` succeeds, otherwise `origin/claude/autonomous-agent-team-setup-k424uv`.
   - If `origin/ops/state` exists: `git checkout -B ops/state origin/ops/state`, then `git merge --no-edit $BASE`. On conflicts inside `shack/state`, `shack/agents/*/state.json` or `shack/logs`, keep the ops/state side; for everything else take BASE.
   - Otherwise: `git checkout -B ops/state $BASE`.
2. Read `shack/hub/DIRECTOR.md`, `shack/hub/RULEBOOK.md` and `shack/config.json`, and run one full cycle exactly as DIRECTOR.md describes. Pick the cycle name (dawn, after-school or night) from config.json by the current New York time. Dispatch the four spoke agents in parallel with the Agent tool. If a connector (Gmail, Google Calendar, Google Drive, Shopify, Metricool) is missing from this session, mark the dependent tasks blocked with the reason "connector not attached to Routine" and continue with the rest.
3. Push only to `ops/state`. Never push to `main` or any other branch. The only pull request you may open is the weekly ops/state → main merge that DIRECTOR.md describes. If a push is refused (for example a 403), say so in the report: the repo isn't attached to the Routine.
4. End with the compact cycle report table from DIRECTOR.md.
