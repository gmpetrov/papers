"""Install the built wheel into an isolated environment and exercise public imports."""
from pathlib import Path
import os
import subprocess
import tempfile
import shutil

root = Path(__file__).resolve().parents[1]
uv = shutil.which("uv") or str(root / ".venv/bin/uv")
wheels = list((root / "sdks/python/dist").glob("*.whl"))
if len(wheels) != 1:
    raise RuntimeError("Build exactly one current Python wheel before this check")
with tempfile.TemporaryDirectory(prefix="papers-wheel-check-") as directory:
    environment = Path(directory) / "venv"
    subprocess.run([uv, "venv", str(environment), "--python", "3.10"], check=True, capture_output=True)
    python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    subprocess.run([uv, "pip", "install", "--python", str(python), str(wheels[0])], check=True, capture_output=True)
    code = '''
import asyncio
import httpx
from papers import Papers, AsyncPapers, PapersError

def handle(request):
    assert request.headers["Authorization"] == "Bearer fixture"
    assert request.url.params["limit"] == "2"
    assert request.url.path == "/v1/inboxes"
    cursor = request.url.params.get("cursor")
    return httpx.Response(200, json={"data": [{"id": "second" if cursor else "first", "name": "Fixture", "address": "fixture@example.test", "status": "active"}], "nextCursor": None if cursor else "next"})

with Papers("fixture", transport=httpx.MockTransport(handle)) as client:
    assert [inbox.id for inbox in client.iter_inboxes(limit=2)] == ["first", "second"]

async def main():
    async with AsyncPapers("fixture", transport=httpx.MockTransport(handle)) as client:
        assert [inbox.id async for inbox in client.iter_inboxes(limit=2)] == ["first", "second"]
asyncio.run(main())
print("Installed Python wheel imports and sync/async resource pagination passed.")
'''
    subprocess.run([str(python), "-I", "-c", code], cwd=directory, check=True)
