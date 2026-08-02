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


# -- 2026-08-02: Medical on both profiles, Queue renamed Unfiled, report
# detail screen with a 90-day window, filters and pagination ----------------

def test_medical_is_offered_on_both_profiles():
    assert "Yaron: ['LTI', 'TP', 'INSEAD-YARON', 'MEDICAL']" in HTML
    assert "Ella: ['INSEAD-ELLA', 'MEDICAL']" in HTML
    assert "'MEDICAL': 'MEDICAL'" in HTML


def test_queue_tab_relabeled_unfiled_without_renaming_its_internal_id():
    assert '<button data-tab="queue">Unfiled</button>' in HTML
    # The internal id stays "queue" -- only the visible label changed, so
    # nothing else in the file needed touching.
    assert 'id="tab-queue"' in HTML


def test_synced_capture_drops_off_once_its_report_is_no_longer_cached():
    prune = HTML[HTML.index("function pruneQueueForSentReports") :]
    assert "if (!item.synced) return true;" in prune
    assert "if (!item.reportRef) return true;" in prune
    assert "cachedRefs.has(item.reportRef)" in prune
    assert "function renderQueue() {\n  const list = pruneQueueForSentReports();" in HTML


def test_report_detail_view_exists_with_filters_and_pagination():
    assert 'id="report-detail-view"' in HTML
    assert 'id="report-detail-search"' in HTML
    assert 'id="report-detail-chips"' in HTML
    assert 'id="report-detail-more"' in HTML
    assert "DETAIL_PAGE_SIZE = 25" in HTML
    assert "Only the last 90 days of this report are shown here" in HTML


def test_report_rows_open_the_detail_view():
    assert "data-open-report=" in HTML
    assert "openReportDetail(row.dataset.openReport" in HTML


# -- 2026-08-03: binding rule, wiki/protocols/app-ui-design-rules.md line 151
# -- any date shown as text is dd/mm/yyyy, never yyyy-mm-dd. Found live: the
# report-detail screen and the Unfiled/Queue tab both showed the raw PCExpenses
# ISO string unformatted.

def test_ddmmyyyy_formatter_exists_and_uses_slashes():
    assert "function ddmmyyyy(dateStr)" in HTML
    formatter = HTML[HTML.index("function ddmmyyyy(dateStr)"):]
    assert "${parts[2]}/${parts[1]}/${parts[0]}" in formatter[:400]


def test_report_detail_and_queue_rows_use_the_formatter_not_the_raw_date():
    assert "${ddmmyyyy(x.date)}" in HTML
    assert "${ddmmyyyy(item.date)}" in HTML
    assert "${x.date || ''}" not in HTML
    assert "${item.date || ''} &middot;" not in HTML
