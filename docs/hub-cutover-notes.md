# Hub cutover notes (project 5)

What project 5 changes to move the cloud worker, the laptop skill and memo uploads from Todoist to the hub. Nothing here is installed or switched on yet. Todoist keeps running until these steps are done.

Files this uses (all in this repo):

| File | What it is |
| --- | --- |
| `hub/worker/PROMPT.md` | The worker prompt: todo-hub's steps 1 to 9, every Todoist step replaced by a `hub` command |
| `hub/worker/setup.sh` | Checks the routine's env and Node, puts `projects.json` where `bin/hub` reads it, runs `hub setup` |
| `hub/worker/projects.json` | Project label to GitHub repo, copied from todo-hub |
| `hub/skills/hub/SKILL.md` | The laptop skill, using the hub connector instead of Todoist |
| `tests/e2e/hub-dry-run.spec.ts` | One worker run against local Supabase; run it with `npm run e2e:hub` |

## Env vars

### Cloud routine environment (claude.ai/code, the routine's custom environment)

| Var | Value | Note |
| --- | --- | --- |
| `HUB_URL` | `https://masonbair.com` | The host that answers without a redirect (use `www.` if the bare domain redirects) |
| `HUB_WORKER_TOKEN` | same value as in Vercel | Mason enters it; never in a file |
| `NTFY_TOPIC` | same topic todo-hub uses | Phone pings for finish, block and alerts |
| `HUB_TIME_ZONE` | `America/Denver` | Mason travels: change it when he is somewhere else for a while. `setup.sh` refuses to start without it |
| `HUB_PROJECTS_FILE` | leave unset | `setup.sh` copies `hub/worker/projects.json` to `~/.config/hub/projects.json`, the default path |

Remove `TODOIST_TOKEN` from the routine environment once the worker no longer needs Todoist.

Network allowlist: add `masonbair.com` (and `www.masonbair.com` if that is the answering host). Keep `ntfy.sh` and the defaults. Drop `api.todoist.com` after the cutover.

**Node:** `bin/hub` needs Node 22.18 or newer (it runs TypeScript with Node's built-in type stripping; there is no `npm install`). todo-hub ran through `tsx`, so its routine never showed which Node the cloud image has, and this was not checked here. `setup.sh` stops with "needs Node 22.18 or newer, found vX" if it is older. If that happens, add `nvm install 24 && nvm alias default 24` to the environment's setup script.

### Vercel (myWebsite project, Production)

| Var | Set when | Note |
| --- | --- | --- |
| `HUB_WORKER_LIVE` | at cutover, to `true` | Shows the Approve button. Until then an approved item would sit unnoticed |
| `ROUTINE_FIRE_URL`, `ROUTINE_FIRE_TOKEN` | at cutover, both together, and only once the routine runs the new prompt | The routine's API trigger. The fire text is `hub-item-id: <id>`; the old prompt only knows `todoist-task-id:`, so setting these early sends runs the old prompt can't read |
| `HUB_WORKER_TOKEN`, `HUB_AGENT_TOKEN`, `MEMO_UPLOAD_TOKEN`, `HUB_EVENTS_TOKEN`, `NTFY_TOPIC` | already, from the private side | Each made with `openssl rand -hex 32` (not `NTFY_TOPIC`) |

Redeploy after changing any of them.

### Laptop

`~/.config/hub/env`, mode 600, for running `bin/hub` by hand (`hub laptop`, `hub memo-seed`). `bin/hub` reads it for keys not already set:

```sh
! mkdir -p ~/.config/hub && read -s "t?Hub worker token: " && printf 'HUB_URL=https://masonbair.com\nHUB_WORKER_TOKEN=%s\nNTFY_TOPIC=<topic>\nHUB_TIME_ZONE=America/Denver\n' "$t" > ~/.config/hub/env && chmod 600 ~/.config/hub/env
```

## Vault secrets (Supabase)

`hub_events_url` and `hub_events_token` drive the approval fire, reminders and backups. Their setup is in `docs/hub-setup.md` ("Events"). The cutover adds no new Vault secret. Check both exist before setting `ROUTINE_FIRE_*`: until they do, the database never calls `/api/hub/events/approved`, so approvals only get picked up by scheduled runs.

## Routine changes

Edit the existing "todo-hub worker" routine on claude.ai/code/routines (keep its API trigger, so the fire URL and token stay the same):

- Repos: add `masonbair/myWebsite`. Keep every repo in `hub/worker/projects.json` (the worker codes in them). todo-hub can go once the cutover is done.
- Prompt: `Follow hub/worker/PROMPT.md in the myWebsite repo exactly. Act on a hub-item-id in the routine-fire-payload as that file describes.`
- Environment: the env vars and network list above.
- Schedule: unchanged (8:07, 12:07, 17:07, 21:07 local).
- Connectors: Granola and Google Calendar stay. Todoist can be detached once nothing needs it; the prompt already forbids using it.

## Laptop connector and skill

```sh
claude mcp add --scope user --transport http hub https://masonbair.com/api/mcp/mcp \
  --header "Authorization: Bearer <HUB_AGENT_TOKEN>" --header "X-Client-Name: claude-code"
```

The server name must be `hub`: the skill calls its tools as `mcp__hub__*`. Then copy `hub/skills/hub/` to `~/.claude/skills/hub/` and remove `~/.claude/skills/todo-hub/`, in the same step, so two skills never answer "add that to my list".

Behavior change: the old skill finished a laptop task by setting `claude-done`. The hub lets only Mason and the worker change `claude` and `claude-*` labels, so the new skill posts the result, drops `laptop`, and tells Mason to clear the item himself.

## Order for project 5

1. Private side live in production; Vault secrets set and checked (`docs/hub-setup.md`).
2. Import Todoist's open tasks, labels and comments into the hub (project 5's own import). Check counts before going on: nothing captured may be lost.
3. Stop the old fire path: unset `ROUTINE_FIRE_URL` and `ROUTINE_FIRE_TOKEN` in the todo-hub Vercel project (or remove its Todoist webhook), so Todoist approvals stop starting runs.
4. Run `hub memo-seed <list-file>` with every HiDock file name todo-hub already filed, so a re-upload doesn't file a memo twice.
5. Point the phone and Mac memo uploaders at `https://masonbair.com/api/memo` with `MEMO_UPLOAD_TOKEN`.
   - Then switch on Ideas Lab memo detection as in "Ideas Lab: memo detection" below.
6. Update the routine (repos, prompt, environment) as above.
7. In Vercel set `ROUTINE_FIRE_URL`, `ROUTINE_FIRE_TOKEN` and `HUB_WORKER_LIVE=true`, then redeploy. Steps 6 and 7 go together: the fire text and the prompt must match.
8. Laptop: `claude mcp add`, swap the skill, write `~/.config/hub/env`.
9. Check, in order:
   - Approve a throwaway item in the hub. A fired run should claim it, finish or block it, and ping the phone within minutes.
   - "Run now" on the routine for a scheduled run. Watch for `hub alert` pings; check the inbox got sorted and nothing is `done`.
   - Say "add that to my list" in Claude Code and see the item in the hub inbox.
10. Run both side by side for a short while, then stop writing to Todoist.

## Ideas Lab: memo detection

Memo detection ships off. While it is off, the memo relay files memos exactly as before and the Ideas Lab reads only phone and web captures. Switch it on only after step 5 above, once the uploaders send memos to the hub:

1. Unload the HiNote recording intake first, if task 6b installed it on the Mac (its plist and the uninstall commands are in `docs/hub-setup.md`). Otherwise the same recordings reach the Ideas Lab twice.
2. In Vercel (myWebsite, Production) set `IDEAS_MEMO_DETECTION=on` and redeploy. From then on each new memo the relay files also gets an `idea_sources` row (kind `memo`, pending), and the Ideas Lab job reads it. Memos filed before the switch are not read.
3. Nothing to change in the worker: the memo split already skips ideas the Ideas Lab owns. `hub memos` gives each memo `ideasOwnedByIdeasLab` (true while its detection is waiting or done, false once it failed or when it was never queued) and `ideasFiled` (idea item ids filed so far). When owned, the worker leaves its `ideas` list empty for that memo, and `hub memo-split` drops the pieces file's ideas anyway. To-dos and notes, including notes for no known project, are still the memo split's. A memo the split archives is still read for ideas.
4. Check: upload a test memo that holds one idea. Within 15 minutes it should appear in the Ideas list with the quote and a link back to the memo, and the memo should stay open in the inbox.

To switch it off again, unset `IDEAS_MEMO_DETECTION` and redeploy. Memos already queued are still read; new ones are not.

Before switching, run the dry run locally (`npm run e2e:hub`): it plays one worker run with canned decisions against local Supabase and checks nothing is deleted or completed.
