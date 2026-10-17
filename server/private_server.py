"""Single-user, SSH-tunnel-only relay for the Gemini Developer Live API.

No Vertex credentials, CAPTCHA, Redis, analytics, transcript storage, or API
key in browser code. This module must run with one Uvicorn worker.
"""
import asyncio
import contextlib
import logging
import os
from pathlib import Path
import secrets
import time

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from google import genai
from google.genai import types

load_dotenv(override=False)
logger = logging.getLogger(__name__)
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
DIST = Path("dist").resolve()
MODEL = os.getenv("MODEL", "gemini-3.8-live")
SESSION_SECONDS = min(900, max(30, int(os.getenv("SESSION_TIME_LIMIT", "600"))))
ORIGINS = set(os.getenv("ALLOWED_ORIGINS", "http://127.0.0.1:18090,http://localhost:18090").split(","))
HOSTS = {origin.split("://", 1)[1] for origin in ORIGINS}
tokens = {}
active_session = False
last_auth = 0.0

TUTOR_RULES = """
You are a patient German speaking tutor. Default to CEFR A2 unless the learner
requests another level. Keep the selected roleplay and its objective, but adapt
it to the learner: clear standard German, one short question at a time, enough
time to answer, and sentence starters when needed. Explain important corrections
briefly in English, invite a retry, then return to German. Do not interrupt every
minor error. Ask for repetition if audio is unclear; do not invent mistakes.
Increase difficulty cautiously within this session, with the learner in control.
You have no saved memory from earlier sessions; never claim otherwise. Do not
claim to certify a CEFR level. Practice is educational roleplay, not medical care.
"""


@app.middleware("http")
async def local_access(request: Request, call_next):
    # SSH authentication protects remote access; validate Host and Origin to
    # prevent unrelated web pages from spending the owner's key through localhost.
    if request.headers.get("host") not in HOSTS:
        return JSONResponse({"detail": "Host not allowed"}, status_code=403)
    origin = request.headers.get("origin")
    if origin and origin not in ORIGINS:
        return JSONResponse({"detail": "Origin not allowed"}, status_code=403)
    if request.method == "POST" and origin not in ORIGINS:
        return JSONResponse({"detail": "Same-origin request required"}, status_code=403)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Permissions-Policy"] = "microphone=(self), camera=()"
    return response


@app.get("/healthz")
async def health():
    return {"status": "ok"}


@app.get("/api/status")
async def status():
    return {"mode": "simple", "missing": ["recaptcha", "redis"], "private": True}


@app.post("/api/auth")
async def authenticate():
    global last_auth
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(503, "Server API key is not configured")
    now = time.monotonic()
    if active_session:
        raise HTTPException(409, "A speaking session is already active")
    if now - last_auth < 2:
        raise HTTPException(429, "Please wait a moment before reconnecting")
    last_auth = now
    tokens.clear()
    token = secrets.token_urlsafe(32)
    tokens[token] = now + 30
    return {"session_token": token, "session_time_limit": SESSION_SECONDS}


def live_config(setup):
    """Allow only voice tutoring options; never pass arbitrary client tools."""
    voice = setup.get("generation_config", {}).get("speech_config", {}).get("voice_config", {}).get("prebuilt_voice_config", {}).get("voice_name", "Puck")
    if not isinstance(voice, str) or len(voice) > 40:
        raise ValueError("Invalid voice")
    scenario = setup.get("system_instruction", {}).get("parts", [{}])[0].get("text", "")
    if not isinstance(scenario, str) or len(scenario) > 20000:
        raise ValueError("Invalid scenario")
    args = dict(
        response_modalities=["AUDIO"],
        system_instruction=scenario + "\n\nOwner's tutoring preferences:\n" + TUTOR_RULES,
        speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice))),
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(
                silence_duration_ms=1800, prefix_padding_ms=300)),
        tools=[types.Tool(function_declarations=[types.FunctionDeclaration(
            name="complete_mission",
            description="Finish the selected conversation objective and give feedback.",
            parameters={"type": "OBJECT", "properties": {
                "score": {"type": "INTEGER"},
                "feedback_pointers": {"type": "ARRAY", "items": {"type": "STRING"}},
            }, "required": ["score", "feedback_pointers"]})])],
    )
    for option in ("input_audio_transcription", "output_audio_transcription"):
        if option in setup:
            args[option] = types.AudioTranscriptionConfig()
    return types.LiveConnectConfig(**args)


async def relay(ws, setup):
    # Explicit vertexai=False prevents ambient Google Cloud configuration from
    # changing the API backend. No paid-model fallback is implemented.
    client = genai.Client(vertexai=False, api_key=os.environ["GEMINI_API_KEY"])
    try:
        async with client.aio.live.connect(model=MODEL, config=live_config(setup)) as session:
            await ws.send_json({"setupComplete": {}})

            async def upstream():
                while True:
                    message = await ws.receive()
                    if message["type"] == "websocket.disconnect":
                        return
                    if message.get("bytes"):
                        await session.send_realtime_input(audio=types.Blob(
                            data=message["bytes"], mime_type="audio/pcm;rate=16000"))
                    elif message.get("text"):
                        import json
                        payload = json.loads(message["text"])
                        if "client_content" in payload:
                            content = payload["client_content"]
                            await session.send_client_content(
                                turns=content.get("turns", []),
                                turn_complete=bool(content.get("turn_complete", True)))

            async def downstream():
                while True:
                    async for response in session.receive():
                        content = response.server_content
                        if content:
                            if content.interrupted:
                                await ws.send_json({"serverContent": {"interrupted": True}})
                            if content.model_turn:
                                for part in content.model_turn.parts or []:
                                    if part.inline_data and part.inline_data.data:
                                        await ws.send_bytes(part.inline_data.data)
                            for attr, wire in (("input_transcription", "inputTranscription"),
                                               ("output_transcription", "outputTranscription")):
                                transcript = getattr(content, attr, None)
                                if transcript and transcript.text:
                                    await ws.send_json({"serverContent": {wire: {
                                        "text": transcript.text, "finished": False}}})
                            if content.turn_complete:
                                await ws.send_json({"serverContent": {"turnComplete": True}})
                        if response.tool_call:
                            results = []
                            for fc in response.tool_call.function_calls:
                                if fc.name == "complete_mission":
                                    await ws.send_json({"toolCall": {"functionCalls": [{
                                        "name": fc.name, "id": fc.id, "args": fc.args or {}}]}})
                                results.append(types.FunctionResponse(name=fc.name, id=fc.id,
                                    response={"result": "acknowledged"}))
                            await session.send_tool_response(function_responses=results)

            tasks = [asyncio.create_task(upstream()), asyncio.create_task(downstream())]
            try:
                done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    task.result()
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        await client.aio.aclose()
        client.close()


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str = ""):
    global active_session
    if (ws.headers.get("host") not in HOSTS or
            ws.headers.get("origin") not in ORIGINS):
        await ws.close(code=1008)
        return
    expiry = tokens.pop(token, 0)
    if expiry < time.monotonic() or active_session:
        await ws.close(code=1008)
        return
    active_session = True
    await ws.accept()
    try:
        message = await asyncio.wait_for(ws.receive_json(), timeout=10)
        setup = message.get("setup")
        if not isinstance(setup, dict):
            raise ValueError("Missing setup")
        await asyncio.wait_for(relay(ws, setup), timeout=SESSION_SECONDS)
    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    except Exception as exc:
        # SDK exceptions can contain URLs/keys. Log only the exception class.
        logger.warning("Voice connection failed (%s)", type(exc).__name__)
        with contextlib.suppress(Exception):
            await ws.send_json({"error": "Voice connection failed. Check the model and API quota; billing was not changed."})
    finally:
        active_session = False
        with contextlib.suppress(Exception):
            await ws.close()


@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    candidate = (DIST / full_path).resolve()
    if candidate.is_relative_to(DIST) and candidate.is_file():
        return FileResponse(candidate)
    return FileResponse(DIST / "index.html")
