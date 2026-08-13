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
    assert 'content="2.1"' in HTML
    assert '>v2.1</span>' in HTML
    service_worker = (Path(__file__).parents[1] / "sw.js").read_text(encoding="utf-8")
    assert "eh-mobile-v10" in service_worker


# -- 2026-08-02: Medical on both profiles, Queue renamed Unfiled, report
# detail screen with a 90-day window, filters and pagination ----------------

def test_medical_is_offered_on_both_profiles():
    assert "Yaron: ['LTI', 'TP', 'INSEAD-YARON', 'MEDICAL']" in HTML
    assert "Ella: ['INSEAD-ELLA', 'MEDICAL']" in HTML
    assert "'MEDICAL': 'MEDICAL'" in HTML


def test_queue_tab_is_called_sync_without_renaming_its_internal_id():
    # Renamed from Unfiled on 13/08/2026. The old name was wrong twice over:
    # the list holds captures that ARE in a report, and "unfiled" described
    # neither what is in it nor what leaves it.
    assert '<button data-tab="queue">Sync</button>' in HTML
    assert "Unfiled</button>" not in HTML
    # The internal id stays "queue" -- only the visible label changed, so
    # nothing else in the file needed touching.
    assert 'id="tab-queue"' in HTML


def test_a_capture_the_pc_already_has_leaves_this_phone():
    """The user's rule, 13/08/2026: "expense with no report should stay forever.
    expense with a report that is synced on PC should not stay in sync at all."

    The old code had the opposite hole: it only ever let go of a capture whose
    reportRef had disappeared, so anything captured straight to unfiled was kept
    permanently. A first attempt at fixing it expired unconfirmed captures after
    30 days; he rejected that, because a capture with no report is a job still
    to do and a timer that quietly deletes a job is worse than a long list.
    """
    prune = HTML[HTML.index("function pruneQueueForSentReports") :]
    prune = prune[: prune.index("function queueRowsToShow")]
    assert "if (!item.synced) return true;" in prune
    # Only a report gone from the PC's list actually deletes a capture.
    assert "if (item.reportRef) return cachedRefs.has(item.reportRef);" in prune
    assert "    return true;\n  });" in prune
    assert "QUEUE_KEEP_DAYS" not in HTML
    assert "captureAgeDays" not in HTML

    # Showing and storing are two different questions. The Sync tab hides a
    # capture the PC already holds; storage keeps it, because that capture
    # carries the phone's own photo and is what makes the expense openable and
    # editable here. Deleting it took the user's own expenses away from him
    # minutes after he made them (13/08/2026, his item 3).
    show = HTML[HTML.index("function queueRowsToShow"):]
    show = show[: show.index("function queueState")]
    assert "pcKeys.has(pendingKey(item.date, item.amount, item.category))" in show
    assert "pruneQueueForSentReports()" in show
    assert "function renderQueue() {\n  const list = queueRowsToShow();" in HTML


def test_quick_save_asks_for_nothing_but_the_photo():
    # Quick save is a photo and nothing else: snap the receipt on the way out
    # and deal with it later. Requiring a report type broke that (13/08/2026).
    assert "function saveCapture(opts) {" in HTML
    assert "if (!(opts && opts.quick) && !validateCapture()) return false;" in HTML
    assert "saveCapture({ quick: true });" in HTML


def test_the_expense_date_is_never_rendered_by_the_browser():
    # lang="en-GB" did not work and could not: a native date input takes its
    # format from the DEVICE locale, not the document. The visible field is
    # ours now, and the native input is kept only to borrow its calendar.
    assert 'id="f-date-text"' in HTML
    assert 'id="f-date" type="date" class="date-native"' in HTML
    assert "function setExpenseDate(iso)" in HTML
    assert "function isoFromDdmmyyyy(text)" in HTML
    assert "document.getElementById('f-date-text').value = ddmmyyyy(text);" in HTML
    assert "date: expenseDateIso()," in HTML


def test_a_warning_is_amber_and_only_a_real_failure_is_red():
    assert "#toast.show { display: block; background: var(--amber-bg);" in HTML
    assert "#toast.show.is-error" in HTML
    assert "function showToast(message, isError)" in HTML


def test_a_receiptless_capture_is_not_refused_by_the_pc():
    # The phone's Save button deliberately does not require a photo, so the
    # importer must not require one either (13/08/2026).
    pull = (
        Path(r"C:\Users\2simp\expense-hub") / "expense_hub" / "mobile_pull.py"
    )
    if not pull.is_file():
        return
    source = pull.read_text(encoding="utf-8")
    assert '"no usable photo in the export"' not in source
    assert "uploads[0] if uploads else None" in source


def test_sync_now_says_what_it_is_doing():
    # It used to push silently and never pull, so pressing it with nothing
    # queued did nothing visible at all and read as a broken button.
    assert "let syncInFlight = false;" in HTML
    assert "async function attemptSync(userAsked)" in HTML
    sync = HTML[HTML.index("async function attemptSync(userAsked)"):]
    sync = sync[: sync.index("// ---- Reports:")]
    assert "updateSyncStrip(queued ? `Sending ${queued}...` : 'Checking the PC...');" in sync
    assert "await fetchReports();" in sync
    assert "showToast(" in sync
    assert "#sync-strip.busy" in HTML


def test_a_rejected_line_is_visible_on_the_phone_too():
    # A line refused on the PC looked completely normal on the phone, and the
    # phone's total counted it, so the two apps disagreed (13/08/2026).
    assert "const rejectedPill = x.rejected" in HTML
    assert "rejected-pill" in HTML
    assert ".exrow.is-rejected .amt" in HTML
    assert "const rejectedTotal = rejectedLines.reduce(" in HTML
    push = (
        Path(r"C:\Users\2simp\expense-hub") / "expense_hub" / "mobile_push.py"
    )
    if not push.is_file():
        return
    source = push.read_text(encoding="utf-8")
    assert '"rejected": bool(line.get("rejected")),' in source
    assert '"rejectedNote": line.get("rejected_note", ""),' in source


def test_the_native_date_picker_follows_the_dd_mm_yyyy_rule():
    # A native <input type="date"> takes its format from the document
    # language. "en" gave mm/dd/yyyy. The user overrode the design rules'
    # native-picker exemption on 13/08/2026.
    assert '<html lang="en-GB">' in HTML
    assert '<html lang="en">' not in HTML


def test_the_description_field_carries_no_placeholder():
    assert 'placeholder="What this was for"' not in HTML


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


def test_a_line_this_phone_captured_can_be_edited_from_inside_the_report():
    # The user made an expense on the phone and then could not edit it from the
    # report he had just put it in (13/08/2026, his item 4). The queued capture
    # is matched by localId while it is still waiting, and by date/amount/
    # category once the PC has it, so it stays editable either way.
    assert "function localCaptureFor(line)" in HTML
    assert 'data-edit-line="${escapeHtml(local.localId)}"' in HTML
    assert "openForEdit(button.dataset.editLine)" in HTML
    # On the opened panel, not the row, so looking at a receipt never starts an
    # edit by accident.
    assert "event.stopPropagation();" in HTML
