import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from server import private_server as server

ORIGIN = {"Origin": "http://127.0.0.1:18090"}


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("TUTOR_DB_PATH", str(tmp_path / "progress.sqlite3"))
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")
    server.tokens.clear()
    server.active_session = False
    server.last_auth = 0
    with TestClient(server.app, base_url="http://127.0.0.1:18090") as client:
        yield client


def test_cross_site_requests_and_dns_rebinding_blocked(client):
    assert client.post("/api/auth", headers={"Origin": "https://other.example"}).status_code == 403
    assert client.post("/api/auth").status_code == 403
    assert client.get("/api/status", headers={"Host": "other.example"}).status_code == 403


def test_missing_key_and_single_session_guard(client, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY")
    assert client.post("/api/auth", headers=ORIGIN).status_code == 503
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")
    server.active_session = True
    assert client.post("/api/auth", headers=ORIGIN).status_code == 409


def test_one_time_expiring_websocket_tokens(client, monkeypatch):
    async def fake_relay(ws, setup):
        await ws.send_json({"setupComplete": {}})
    monkeypatch.setattr(server, "relay", fake_relay)
    token = client.post("/api/auth", headers=ORIGIN).json()["session_token"]
    with client.websocket_connect(f"ws://127.0.0.1:18090/ws?token={token}", headers=ORIGIN) as ws:
        ws.send_json({"setup": {}})
        assert "setupComplete" in ws.receive_json()
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"ws://127.0.0.1:18090/ws?token={token}", headers=ORIGIN):
            pass
    server.tokens["expired"] = 0
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("ws://127.0.0.1:18090/ws?token=expired", headers=ORIGIN):
            pass
    assert not server.active_session


def test_config_restricts_tools_and_sets_tutoring_preferences():
    config = server.live_config({"tools": {"google_search": {}},
                                "input_audio_transcription": {}})
    assert "CEFR A2" in config.system_instruction
    assert "never invent earlier conversations" in config.system_instruction
    assert config.input_audio_transcription is not None
    assert len(config.tools) == 1
    assert config.tools[0].google_search is None
    assert config.tools[0].function_declarations[0].name == "complete_mission"


def test_disconnect_closes_upstream_without_waiting_for_session_limit(monkeypatch, tmp_path):
    monkeypatch.setenv("TUTOR_DB_PATH", str(tmp_path / "progress.sqlite3"))
    async def exercise():
        cancelled = asyncio.Event()
        class FakeSession:
            async def receive(self):
                try:
                    await asyncio.Event().wait()
                    yield None
                finally:
                    cancelled.set()
        @asynccontextmanager
        async def connect(**kwargs):
            yield FakeSession()
        fake = SimpleNamespace(aio=SimpleNamespace(live=SimpleNamespace(connect=connect),
                                                   aclose=AsyncMock()), close=lambda: None)
        def make_client(**kwargs):
            assert kwargs["vertexai"] is False
            return fake
        monkeypatch.setattr(server.genai, "Client", make_client)
        monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")
        ws = SimpleNamespace(send_json=AsyncMock(), receive=AsyncMock(
            return_value={"type": "websocket.disconnect"}))
        await asyncio.wait_for(server.relay(ws, {}), timeout=1)
        fake.aio.aclose.assert_awaited_once()
        assert cancelled.is_set()
    asyncio.run(exercise())


def test_profile_persists_valid_preferences_and_rejects_untrusted_changes(client):
    assert client.get("/api/profile").json()["level"] == "A2"
    assert client.post("/api/profile", json={"level": "B1", "topic": "Travel"}).status_code == 403
    assert client.post("/api/profile", headers=ORIGIN, json={"level": "doctor"}).status_code == 422
    assert client.post("/api/profile", headers=ORIGIN, json={"topic": "x" * 301}).status_code == 422
    assert client.post("/api/profile", headers=ORIGIN, json={"level": "B1", "topic": "Travel"}).status_code == 200
    assert server.profile()["level"] == "B1"
    server.active_session = True
    assert client.post("/api/profile/reset", headers=ORIGIN).status_code == 409


def test_checkpoints_update_one_session_and_reset_does_not_remove_settings(client):
    client.post("/api/profile", headers=ORIGIN, json={"level": "B2", "topic": "Hobbies"})
    for focus in ["Word order", "Past tense"]:
        server.save_coaching("same-session", "B2", {"feedback": ["Practise verb placement"], "next_focus": focus})
    data = client.get("/api/profile").json()
    assert len(data["sessions"]) == 1
    assert data["sessions"][0]["next_focus"] == "Past tense"
    assert "transcript" not in data["sessions"][0]
    assert client.post("/api/profile/reset").status_code == 403
    cleared = client.post("/api/profile/reset", headers=ORIGIN).json()
    assert cleared["sessions"] == []
    assert cleared["level"] == "B2"
    assert cleared["topic"] == "Hobbies"


def test_open_conversation_context_is_bounded_and_manual_level_is_authoritative():
    history = [{"feedback": [str(n)], "next_focus": "Questions"} for n in range(10)]
    config = server.live_config({"tutor_session": {"open_conversation": True}},
                               {"level": "B1", "topic": "Travel", "sessions": history})
    assert "Use chosen level B1" in config.system_instruction
    assert "OPEN CONVERSATION overrides" in config.system_instruction
    assert '"feedback": ["9"]' not in config.system_instruction
    assert {f.name for f in config.tools[0].function_declarations} == {"complete_mission", "save_progress"}


def test_invalid_and_oversized_coaching_cannot_be_saved(client):
    with pytest.raises(ValueError):
        server.save_coaching("one", "A2", {"feedback": ["x" * 601]})
    with pytest.raises(ValueError):
        server.save_coaching("one", "A2", {"feedback": ["a"] * 7})
    assert server.profile()["sessions"] == []


def test_relay_saves_checkpoint_and_completion_before_notifying_browser(client, monkeypatch):
    async def exercise():
        finished = asyncio.Event()
        class FakeSession:
            async def receive(self):
                for name, args in [
                    ('save_progress', {'feedback': ['Practise verb-second word order'], 'next_focus': 'Ask two questions about travel'}),
                    ('complete_mission', {'score': 0, 'feedback_pointers': ['Use the finite verb second']})]:
                    yield SimpleNamespace(server_content=None, tool_call=SimpleNamespace(function_calls=[SimpleNamespace(name=name, id=name, args=args)]))
                finished.set()
                await asyncio.Event().wait()
            send_tool_response = AsyncMock()
        fake_session = FakeSession()
        @asynccontextmanager
        async def connect(**kwargs):
            yield fake_session
        fake_client = SimpleNamespace(aio=SimpleNamespace(live=SimpleNamespace(connect=connect), aclose=AsyncMock()), close=lambda: None)
        monkeypatch.setattr(server.genai, 'Client', lambda **kwargs: fake_client)
        async def disconnected():
            await finished.wait()
            return {'type': 'websocket.disconnect'}
        ws = SimpleNamespace(send_json=AsyncMock(), receive=disconnected)
        await asyncio.wait_for(server.relay(ws, {'tutor_session': {'open_conversation': True}}), timeout=1)
        rows = server.profile()['sessions']
        assert len(rows) == 1
        assert rows[0]['feedback'] == ['Practise verb-second word order', 'Use the finite verb second']
        assert rows[0]['next_focus'] == 'Ask two questions about travel'
        messages = [call.args[0] for call in ws.send_json.call_args_list]
        assert {'progressSaved': True} in messages
        assert any('toolCall' in message for message in messages)
        assert fake_session.send_tool_response.await_count == 2
    asyncio.run(exercise())
