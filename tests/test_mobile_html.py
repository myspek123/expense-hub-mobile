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
    assert 'content="1.7"' in HTML
    assert '>v1.7</span>' in HTML
    service_worker = (Path(__file__).parents[1] / "sw.js").read_text(encoding="utf-8")
    assert "eh-mobile-v6" in service_worker


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
    assert 'id="report-detail-chips"' in HTML
    assert 'id="report-detail-more"' in HTML
    assert "DETAIL_PAGE_SIZE = 25" in HTML
    assert "Only the last 90 days of this report are shown here" in HTML


# -- 2026-08-13 night run ---------------------------------------------------

def test_report_detail_search_is_gone_completely():
    # User decision 4, 13/08/2026: the category pills already do this job.
    # Every trace goes, not just the input, or a dead listener stays behind.
    for token in (
        'id="report-detail-search"',
        'id="report-detail-search-toggle"',
        "search-toggle",
        "detail-searchrow",
        "Search this report",
    ):
        assert token not in HTML, token


def test_queued_receipt_reads_the_base64_field_not_the_photo_object():
    # The queue stores { base64, name }. Mapping the object straight into src=
    # produced src="[object Object]" -- every receipt a broken image (13/08).
    assert "function dataUrlOf(shot)" in HTML
    panel = HTML[HTML.index("function receiptPanelHtml(line)"):]
    panel = panel[: panel.index("function openReportDetail")]
    assert "dataUrlOf(shot)" in panel
    assert ".map((src) => `<img src=" not in HTML
    # The capture strip reads the same one helper, not its own copy.
    strip = HTML[HTML.index("function renderAttachStrip()"):]
    assert "dataUrlOf(p).startsWith('data:image')" in strip[:500]


def test_refresh_returns_to_the_screen_the_user_was_on():
    # Pull-to-refresh on a phone browser is a page reload, and the markup makes
    # Add expense active, so every refresh jumped there (item 10, 13/08).
    assert "const TAB_KEY = 'eh_mobile_active_tab';" in HTML
    assert "const OPEN_REPORT_KEY = 'eh_mobile_open_report';" in HTML
    assert "function activateTab(name)" in HTML
    assert "localStorage.setItem(TAB_KEY, name);" in HTML
    assert "function restoreLastScreen()" in HTML
    assert "restoreLastScreen();" in HTML
    # An open report is restored too, but only if the phone still knows it.
    restore = HTML[HTML.index("function restoreLastScreen()"):]
    assert "getCachedReports().find((r) => r.reportRef === openRef)" in restore[:700]


def test_unfiled_captures_can_be_filed_from_inside_a_report():
    assert 'id="report-detail-add-unfiled"' in HTML
    assert 'id="report-detail-unfiled-list"' in HTML
    assert "function fileCaptureIntoCurrentReport(localId)" in HTML
    filer = HTML[HTML.index("function fileCaptureIntoCurrentReport(localId)"):]
    filer = filer[: filer.index("document.getElementById('report-detail-add-unfiled')")]
    # Filing writes the report onto the queued capture and marks it unsynced,
    # which is what saving an edit on the capture screen already does -- the PC
    # then moves the expense through the existing fingerprint path.
    assert "item.reportRef = currentDetailReportRef;" in filer
    assert "item.synced = false;" in filer
    assert "attemptSync();" in filer
    # Nothing unfiled means no role, so no control (design rule 10.2).
    picker = HTML[HTML.index("function renderUnfiledPicker()"):]
    assert "button.classList.add('hidden');" in picker[:900]


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
