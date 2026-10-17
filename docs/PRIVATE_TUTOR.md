# Private voice-test deployment

This is a single-user German speaking tutor with chosen CEFR level and saved
learning checkpoints. It does not certify CEFR progression or provide Anki export.
The original Cloud Run deployment is unchanged; use the private files below.

## Credentials and cost

Use a Gemini Developer API key from a project confirmed as Free tier, with no
billing attached. Enter it on the server into `.env.tutor`, never into Git or
browser code. The software cannot determine or enforce a Google billing tier.
Changing to a billed key can incur costs. Quota errors stop the session; there
is no provider/model fallback. Model availability must be tested with your key.

The model defaults to `gemini-3.8-live`, matching the owner's successful AI
Studio test. Override MODEL only after checking free-tier eligibility. AI Studio
success does not prove Developer API access with a particular project key.

## Deployment

1. Clone this branch into its own server directory; do not use the brain clone.
2. Create a root-only `.env.tutor` from `.env.tutor.example` with your API key.
3. Run `docker compose -f compose.private.yml config --quiet` (never print the
   expanded config: it contains the key), then
   `docker compose -f compose.private.yml up -d --build`.
4. Check `docker compose -f compose.private.yml ps` and health. The published
   port must be **127.0.0.1:18090**, never `0.0.0.0` or `[::]`.
5. On the Mac, forward with SSH:

```bash
ssh -N -i ~/.ssh/brainoutside_ed25519 -o IdentitiesOnly=yes \
  -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:18090:127.0.0.1:18090 root@YOUR_SERVER
```

Open http://127.0.0.1:18090 and allow the microphone. Keep the tunnel running.
Do not attach a public domain, a Coolify proxy route, or firewall exceptions.
SSH controls remote access; this is not a multi-user login system. Other trusted
local users/processes on the Mac or server may access a loopback service.

The image runs non-root, read-only, with 512 MiB RAM, 0.5 CPU, bounded logs and
one session up to 10 minutes. These bounds reduce resource use, but are not a
guarantee of zero effect on other workloads. Build-time usage is separate from
runtime limits. Check available memory while building and stop if needed.

## Privacy and behavior

No audio or transcripts are stored by the private backend, and BigQuery,
reCAPTCHA, Redis, and Google Cloud default credentials are not used. Audio and
selected scenario context still go to Google; free API data-use terms apply.
The browser displays live transcripts and session feedback and upstream UI code
has browser-console diagnostics; do not treat this prototype as a sensitive
records vault. No medical identifiers or patient data should be used in tests.

The relay checks Host and browser Origin and uses expiring one-use connection
tokens. Only the mission-completion and learning-checkpoint tools are enabled. It closes the upstream
connection on client disconnect, timeout, or error. There is no reconnect loop.

## Checks performed before deployment

Frontend production build and automated tests for Host/Origin rejection,
missing credentials, concurrent-session rejection, expired/reused tokens,
restricted tools, and upstream shutdown on disconnect. Real microphone,
barge-in, Gemini quota/model compatibility, Docker build, and VPS resource
measurements still require deployment testing. No live API calls were made by
the preparation environment.

To stop the test: `docker compose -f compose.private.yml stop`. This does not
stop or change the separate BrainOutside or OmniRoute stacks.

## Milestone 2: personal practice and learning checkpoints

The private deployment opens a dedicated German practice dashboard. Choose
A1–C2 (default A2), optionally set a conversation topic, and select Start speaking.
Press the microphone button and say hello. English explanations are brief; the
conversation stays in German. Open conversation does not end at a small mission
objective. Difficulty adapts within the chosen level; level changes remain manual.

Use End Mission or say "finish the session" for a wrap-up. The app requests a
wrap-up 30 seconds before its time limit. Gemini is asked to save a checkpoint
roughly every 3–4 learner turns, with short feedback and one next exercise. Tool
use and correctness remain model-dependent. Abrupt disconnects can lose material
since the last checkpoint; no background second API model is called. A failure to
get final feedback is shown honestly rather than claiming successful completion.

Preferences and up to 100 session records are saved in SQLite on the named
`tutor-progress` Docker volume, owned by the non-root app user. Redeploying keeps
it; deleting the volume loses it. Audio/full transcripts are not stored. Recent
three session summaries are included in Gemini's next conversation context and
must be treated as fallible AI suggestions, not authoritative personal facts or
verified CEFR results. Nothing is written to BrainOutside, Obsidian or GitHub.
The dashboard provides a JSON download and a confirmed clear-history button.
Clear removes live app records, not downloaded copies, backups or provider data;
it is not a forensic erase. Include the volume in any future backup plan.

Update on the VPS (no environment/key changes required):

```bash
cd /data/german-tutor
git pull --ff-only origin codex/private-german-tutor
docker compose -f compose.private.yml config --quiet
docker compose -f compose.private.yml up -d --build
docker compose -f compose.private.yml ps
```

The owner confirmed milestone 1 real microphone conversation, response latency,
interruptions and turn-taking on 18 October 2026 (Dubai). Milestone 2 still needs
a real voice test after deployment, including a saved checkpoint and a second
session using it. Tests use simulated Gemini responses; no live key is used here.

## Teaching protocol files

The private server now loads four Markdown instruction files from `server/tutor/`
at process startup: `teaching.md`, `session.md`, `memory.md`, and `resources.md`.
The private Docker image includes them. They define selective corrections,
uncertain-transcription handling, a brief review/conversation/recap flow, and
cautious use of saved learning observations. They are instructions to Gemini,
not a guarantee that every model answer complies. Test real coaching behavior.

Saved SQLite history remains the single learning-memory store. There is no
second progress Markdown file to copy or sync manually. Three recent records
are supplied automatically; older records remain downloadable but are not all
in the model context. Checkpoints are AI observations, not certified mastery.
The resources file names only the previously reported YourGermanTeacher source;
it does not assert completed lessons or access to any particular course.

To change teaching later, edit these version-controlled files and rebuild/restart
the private container with the normal deployment commands. No extra inference
call, GitHub-reading agent or new provider is introduced by this change. The
instructions are included in the existing live session's input context.
