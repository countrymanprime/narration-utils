"""Ported from shared/hub.Tests/HubContractTests.cs.

Exercises the live HTTP API contract via FastAPI's TestClient instead of a
real Kestrel/uvicorn bind - the ASGI contract is what matters here, not the
transport.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from shared.server.app import build_app
from shared.server.hub_state import HubState


@pytest.fixture
def isolated_appdata(tmp_path, monkeypatch):
    appdata = tmp_path / "appdata"
    appdata.mkdir()
    monkeypatch.setenv("APPDATA", str(appdata))
    return appdata


@pytest.fixture
def client(tmp_path, isolated_appdata):
    session = tmp_path / "session"
    hub = HubState(session_dir=str(session))
    app = build_app(hub, ui_dist_dir=str(tmp_path / "nonexistent-ui-dist"), audio_dir=None)
    with TestClient(app) as test_client:
        yield hub, test_client, session


def test_health_and_bootstrap_return_documented_shape(client):
    hub, test_client, session = client

    health = test_client.get("/api/health").json()
    assert health["apiVersion"] == 1

    bootstrap = test_client.get("/api/bootstrap").json()
    assert bootstrap["apiVersion"] == 1
    assert bootstrap["diagnosticId"] == Path(session).name
    assert bootstrap["daw"] == "REAPER"
    assert bootstrap["transcript"]["markerExport"]["phase"] == "idle"

    hub.close()
    records = [__import__("json").loads(line)["event"] for line in Path(hub.diagnostics.path).read_text(encoding="utf-8").splitlines()]
    assert "bootstrap_completed" in records
    assert "hub_close_requested" in records


def test_unknown_route_returns_not_found_rather_than_silently_succeeding(client):
    _hub, test_client, _session = client
    response = test_client.get("/api/does-not-exist")
    assert response.status_code == 404


def test_marker_export_route_is_exposed_and_rejects_runs_without_live_results(client):
    _hub, test_client, _session = client
    response = test_client.post("/api/transcript/markers/export")
    assert response.status_code == 400
    assert "Run a comparison" in response.json()["detail"]
