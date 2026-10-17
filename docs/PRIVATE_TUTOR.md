# Private voice-test deployment

This is milestone 1: a single-user voice test with A2 German coaching. It does
not implement saved learning history, automatic CEFR progression, or Anki export.
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
tokens. Only the mission-completion tool is enabled. It closes the upstream
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
