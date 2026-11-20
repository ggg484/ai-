"""Read-only published-release discovery; installation still follows the SDK pin."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable

from .config import ConfigError, read_json
from .install import InstallError, RELEASE_PATTERN, read_sdk_pin


def check_updates(project_root: Path, emit: Callable[[str], None] = print) -> int:
    """Report available/current/ahead/unavailable without writing files or authenticating."""
    try:
        pin = read_sdk_pin(project_root)
        record = read_json(project_root / ".builda-online" / "installation.json")
        base = record.get("publicBaseUrl")
        if not isinstance(base, str):
            raise ValueError("missing public base")
        parsed = urllib.parse.urlsplit(base)
        if (parsed.scheme != "https" and not (
            parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        )) or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("invalid public base")
        request = urllib.request.Request(base.rstrip("/") + "/manifest.json", headers={"Accept": "application/json"})
        with urllib.request.urlopen(request, timeout=5) as response:
            data = response.read(1024 * 1024 + 1)
        if len(data) > 1024 * 1024:
            raise ValueError("manifest too large")
        manifest = json.loads(data)
        latest = manifest.get("release_id")
        if not isinstance(latest, str) or not RELEASE_PATTERN.fullmatch(latest):
            raise ValueError("invalid release")
        current_parts = tuple(map(int, pin.split(".")))
        latest_parts = tuple(map(int, latest.split(".")))
        status = "available" if latest_parts > current_parts else "current" if latest_parts == current_parts else "ahead"
        emit(f"updateCheck={status}")
        emit(f"sdkVersion={pin}")
        emit(f"latestRelease={latest}")
        if status == "available":
            emit("nextAction=review-release-notes-and-request-upgrade")
        emit("projectChanged=false")
        return 0
    except (OSError, ValueError, AttributeError, ConfigError, InstallError, urllib.error.URLError):
        # Do not expose endpoint contents, credentials, or interpret a failure as current.
        emit("updateCheck=unavailable")
        emit("projectChanged=false")
        return 0
