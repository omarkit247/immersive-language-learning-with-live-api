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
def client(monkeypatch):
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
    assert "no saved memory" in config.system_instruction
    assert config.input_audio_transcription is not None
    assert len(config.tools) == 1
    assert config.tools[0].google_search is None
    assert config.tools[0].function_declarations[0].name == "complete_mission"


def test_disconnect_closes_upstream_without_waiting_for_session_limit(monkeypatch):
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
