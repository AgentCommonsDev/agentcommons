import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


# @req R-SDK-03 @req R-SDK-04
@pytest.mark.parametrize("kind", ["wheel", "sdist"])
def test_distribution_installs_without_repository_or_development_dependencies(tmp_path, kind):
    package = Path(__file__).parents[1]
    uv = shutil.which("uv")
    assert uv, "Install uv to verify standalone distributions"
    subprocess.run(
        [uv, "build", "--project", str(package), f"--{kind}", "--out-dir", str(tmp_path)],
        check=True,
        capture_output=True,
    )
    archive = next(tmp_path.glob("*.whl" if kind == "wheel" else "*.tar.gz"))
    subprocess.run(
        [sys.executable, "-m", "twine", "check", "--strict", str(archive)],
        check=True,
        capture_output=True,
    )
    environment = tmp_path / "consumer"
    subprocess.run(
        [uv, "venv", str(environment), "--python", "3.11"], check=True, capture_output=True
    )
    python = environment / "bin/python"
    subprocess.run(
        [uv, "pip", "install", "--python", str(python), str(archive)],
        check=True,
        capture_output=True,
    )
    result = subprocess.run(
        [
            str(python),
            "-I",
            "-c",
            """
import importlib, pkgutil
import httpx
from agentcommons import AuthenticatedClient, api, models
from agentcommons.api.default import get_sessions
for package in (api, models):
    for module in pkgutil.walk_packages(package.__path__, package.__name__ + "."):
        importlib.import_module(module.name)
def respond(request):
    assert request.headers["authorization"] == "Bearer example-key"
    return httpx.Response(200, json={"items": [], "cursor": None, "total": {"sessions": 0, "messages": 0}})
with AuthenticatedClient(base_url="https://api.example.test", token="example-key", httpx_args={"transport": httpx.MockTransport(respond)}) as client:
    assert get_sessions.sync(client=client).items == []
print("installed distribution works")
""",
        ],
        cwd=tmp_path,
        env={
            key: value
            for key, value in os.environ.items()
            if key not in {"PYTHONPATH", "VIRTUAL_ENV"}
        },
        check=True,
        capture_output=True,
        text=True,
    )
    assert result.stdout.strip() == "installed distribution works"
