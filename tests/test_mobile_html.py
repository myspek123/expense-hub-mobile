from __future__ import annotations

from pathlib import Path


HTML = (Path(__file__).parents[1] / "index.html").read_text(encoding="utf-8")


def test_sync_code_is_masked_with_explicit_reveal_control():
    assert 'id="f-sync-code" type="password"' in HTML
    assert 'id="toggle-sync-code"' in HTML
    assert "input.type = showing ? 'password' : 'text'" in HTML
    assert "'Hide sync code'" in HTML


def test_photo_is_compressed_before_any_base64_payload_is_created():
    compress = HTML[HTML.index("async function compressImage(file)") :]
    assert "createImageBitmap(file)" in compress
    assert "URL.createObjectURL(file)" in HTML
    assert "canvas.toBlob(" in HTML
    assert "source.close()" in compress
    assert "URL.revokeObjectURL(objectUrl)" in compress
    assert "canvas.width = 1; canvas.height = 1" in compress
    assert "img.src = reader.result" not in HTML
    assert compress.index("compressedCanvasBlob(canvas)") < compress.index(
        "blobAsDataUrl(compressed)"
    )


def test_mobile_release_and_cache_version_are_bumped():
    assert 'content="1.6"' in HTML
    assert '>v1.6</span>' in HTML
    service_worker = (Path(__file__).parents[1] / "sw.js").read_text(encoding="utf-8")
    assert "eh-mobile-v5" in service_worker
