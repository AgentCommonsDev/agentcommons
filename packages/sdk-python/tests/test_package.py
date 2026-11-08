import os
import shutil
import subprocess
from pathlib import Path


# @req R-SDK-03
def test_wheel_installs_without_repository_or_development_dependencies(tmp_path):
    package = Path(__file__).parents[1]
    uv = shutil.which("uv")
    assert uv, "Install uv to verify the standalone wheel"
    subprocess.run(
        [uv, "build", "--project", str(package), "--wheel", "--out-dir", str(tmp_path)],
        check=True,
        capture_output=True,
    )
    environment = tmp_path / "consumer"
    subprocess.run(
        [uv, "venv", str(environment), "--python", "3.11"], check=True, capture_output=True
    )
    python = environment / "bin/python"
    subprocess.run(
        [uv, "pip", "install", "--python", str(python), str(next(tmp_path.glob("*.whl")))],
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
print("installed wheel works")
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
    assert result.stdout.strip() == "installed wheel works"
