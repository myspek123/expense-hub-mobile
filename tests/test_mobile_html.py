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
    assert 'content="3.3"' in HTML
    assert '>v3.3</span>' in HTML
    service_worker = (Path(__file__).parents[1] / "sw.js").read_text(encoding="utf-8")
    assert "eh-mobile-v23" in service_worker
    app_script = (Path(__file__).parents[1] / "apps-script.gs").read_text(encoding="utf-8")
    assert "var VERSION = '1.14';" in app_script
    assert "EUR_AMOUNT" in app_script and "EUR_ESTIMATED" in app_script
    assert 'id="script-version"' in HTML
    assert "function rememberEndpointVersion(payload)" in HTML
    assert "deployedScriptVersion = 'unknown'" in HTML


# -- 2026-08-16 evening: what the first real gallery run turned up ----------

def test_add_many_leaves_the_scanning_to_the_pc():
    """Marking them pending told THIS PHONE to scan them, so a gallery of
    receipts ran that many scans off the handset and every one failed."""
    handler = HTML[HTML.index("document.getElementById('f-many').addEventListener") :]
    handler = handler[: handler.index("document.getElementById('btn-save')")]
    assert "ocrStatus: ''" in handler
    assert "ocrStatus: 'pending'" not in handler


def test_a_failed_scan_says_what_went_wrong():
    drain = HTML[HTML.index("async function drainScanQueue") :]
    drain = drain[: drain.index("async function saveCapture")]
    # the proxy's own reason travels instead of a bare "scan failed"
    assert "result.error.message || result.error.code" in drain
    assert "item.ocrError =" in drain

    markup = HTML[HTML.index("function scanStatusMarkup(item)") :]
    markup = markup[: markup.index("function renderCaptureScanStatus")]
    assert "item.ocrError" in markup


def test_a_report_the_pc_never_took_can_be_removed_from_the_phone():
    """Typed on the phone, never taken by the PC, and there it sat for ever
    with nothing to press."""
    assert "function dropPendingReport(type, name)" in HTML
    reports = HTML[HTML.index("function renderReports()") :]
    reports = reports[: reports.index("function dropPendingReport")]
    # only a local-only row gets the control: a real PC report is the PC's
    assert "r.localOnly" in reports
    assert "data-drop-report" in reports


# -- 2026-08-16: a trip's worth of receipts, straight from the gallery ------

def test_add_many_makes_one_capture_per_photo():
    """The PC's drop zone shape, on the phone: thirty photos become thirty
    captures, each scanned on the PC. Not one capture with thirty photos."""
    assert 'id="btn-many"' in HTML
    assert 'id="f-many"' in HTML and 'multiple' in HTML

    handler = HTML[HTML.index("document.getElementById('f-many').addEventListener") :]
    handler = handler[: handler.index("document.getElementById('btn-save')")]
    # one list entry per file
    assert "for (const [index, file] of files.entries())" in handler
    assert "photos: [{ base64: dataUrl, name: file.name }]" in handler
    # nothing is typed on the phone: the PC scan fills it
    assert "date: '', category: '', amount: ''" in handler
    # a photo that will not read must not lose the rest of the pile
    assert "skipped.push(file.name)" in handler


def test_add_many_reports_what_it_did():
    handler = HTML[HTML.index("document.getElementById('f-many').addEventListener") :]
    handler = handler[: handler.index("document.getElementById('btn-save')")]
    assert "could not be read" in handler
    assert "Sending to the PC" in handler


# -- 2026-08-16: a phone's cards belong to whoever is holding it ------------

def test_cards_are_stored_per_profile():
    """Yaron and Ella do not share a wallet. One shared list put her cards in
    his chips and his in hers."""
    assert "function cardsKey()" in HTML
    key = HTML[HTML.index("function cardsKey()") :]
    key = key[: key.index("function loadCards()")]
    assert "CARDS_KEY + ':' + getProfile()" in key

    load = HTML[HTML.index("function loadCards()") :]
    load = load[: load.index("function saveCards(")]
    # an existing shared list becomes this profile's rather than vanishing
    assert "localStorage.getItem(CARDS_KEY)" in load
    assert "localStorage.setItem(cardsKey()" in load


def test_switching_profile_redraws_the_cards():
    switch = HTML[HTML.index("localStorage.setItem(PROFILE_KEY") :]
    switch = switch[: switch.index("fetchReports();")]
    assert "renderPaidChips();" in switch


# -- 2026-08-16: the PC says what it deleted, so the phone stops waiting ----

def test_a_capture_the_pc_deleted_is_named_as_removed():
    """It used to read "Waiting for PC" for ever: an absent line and a
    discarded line look identical from the phone."""
    state = HTML[HTML.index("function queueState(item)") :]
    state = state[: state.index("function deletedOnPc(item)")]
    assert "Removed on the PC" in state
    # authoritative, so it is answered before every other guess
    assert state.index("deletedOnPc(item)") < state.index("item.awaitingPcUpdate")


def test_the_deleted_flag_comes_from_the_pc_not_from_a_missing_line():
    check = HTML[HTML.index("function deletedOnPc(item)") :]
    check = check[: check.index("function matchingPcLine(item)")]
    assert "line.deleted" in check
    assert "line.localId === item.localId" in check


def test_a_deleted_marker_is_never_read_as_the_pc_holding_the_line():
    prune = HTML[HTML.index("function pruneQueueForSentReports()") :]
    prune = prune[: prune.index("function queueRowsToShow()")]
    assert "cachedExpenses.filter((line) => !line.deleted)" in prune


def test_removed_is_grey_and_struck_through_not_red():
    """Red is for failures. The PC discarding what you told it to discard is a
    finished job."""
    assert ".qrow .status.gone" in HTML
    gone = HTML[HTML.index(".qrow .status.gone") :]
    gone = gone[: gone.index("}")]
    assert "line-through" in gone
    assert "var(--danger)" not in gone


# -- 2026-08-15: tap a receipt on the capture screen to see it full size ----

def test_capture_thumbnails_open_the_receipt_full_size():
    """44px is too small to tell a readable photo from a blurred one, and that
    check belongs BEFORE saving."""
    strip = HTML[HTML.index("function renderAttachStrip()") :]
    strip = strip[: strip.index("document.getElementById('f-photo')")]
    assert "host.querySelectorAll('img.attach-thumb')" in strip
    assert "openReceiptLightbox(image.src)" in strip
    assert "loadPcReceiptForEdit()" in HTML
    assert "editingPcReceiptDataUrl" in strip
    assert "View receipt on PC" not in HTML
    # the remove x must never double as the viewer: the listener is on the
    # image itself, not on the wrapper both controls share
    assert "querySelectorAll('.attach-thumb-wrap')" not in strip


def test_only_one_lightbox_implementation_exists():
    """It was copied inline inside the report-detail handler. One opener now,
    used by both screens."""
    assert HTML.count("lightbox.className = 'receipt-lightbox'") == 1
    assert HTML.count("openReceiptLightbox(") >= 3  # definition + two callers


# -- 2026-08-15: the Sync list can finally be cleared by hand ---------------

def test_sync_list_can_be_cleared_and_the_two_cases_are_separate():
    """Clearing what the PC already holds loses nothing; clearing an unsent
    capture destroys the only copy of its receipt. Two buttons, two warnings,
    never one button that does both."""
    assert 'id="queue-actions"' in HTML
    assert 'id="clear-synced"' in HTML
    assert 'id="clear-phone-only"' in HTML

    actions = HTML[HTML.index("function renderQueueActions()") :]
    actions = actions[: actions.index("function renderQueue()")]
    # the safe button only ever removes captures the PC has
    assert "removeCaptures((item) => pcOwnsCapture(item))" in actions
    # and the destructive one only ever removes captures it has not
    assert "removeCaptures((item) => !pcOwnsCapture(item))" in actions
    # both ask first, and the destructive one says the photo goes with it
    assert actions.count("confirm(") == 3
    assert "cannot be recovered" in actions
    assert "function discardCapture(localId)" in HTML
    assert "data-discard" in HTML
    assert "The PC already has this capture" in HTML


def test_clearing_keeps_every_other_capture():
    remove = HTML[HTML.index("function removeCaptures(predicate)") :]
    remove = remove[: remove.index("function renderQueueActions()")]
    # filter out the matches, save the rest -- never a blanket wipe of the store
    assert "load().filter((item) => !predicate(item) || pcOwnsCapture(item))" in remove
    assert "save(kept)" in remove


# -- 2026-08-02: Medical on both profiles, Queue renamed Unfiled, report
# detail screen with a 90-day window, filters and pagination ----------------

def test_medical_is_offered_on_both_profiles():
    assert "Yaron: ['LTI', 'TP', 'INSEAD-YARON', 'MEDICAL']" in HTML
    # LTI added to Ella on 2026-08-16 at the user's request: she captures
    # against it too, and only the phone was stopping her.
    assert "Ella: ['INSEAD-ELLA', 'LTI', 'MEDICAL']" in HTML
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
    assert "if (!item.synced) return true;" in prune or "if (!item.synced) return;" in prune
    # A PC-taken capture remains in the active list for 30 days, then is
    # marked expired without erasing the phone's receipt.
    assert "30 * 24 * 60 * 60 * 1000" in prune
    assert "item.sentWarning = true" in prune
    assert "QUEUE_KEEP_DAYS" not in HTML
    assert "captureAgeDays" not in HTML

    # Showing and storing are two different questions. The Sync tab retains a
    # PC-taken capture for the 30-day hand-off window; storage keeps it even
    # after expiry so the phone never loses its receipt.
    show = HTML[HTML.index("function queueRowsToShow"):]
    show = show[: show.index("function queueState")]
    assert "!item.expired" in show
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
    assert "function reportEurAmount(line)" in HTML
    assert "function reportLineAmountHtml(line)" in HTML
    assert "missingEurCount" in HTML
    push = (
        Path(r"C:\Users\2simp\expense-hub") / "expense_hub" / "mobile_push.py"
    )
    if not push.is_file():
        return
    source = push.read_text(encoding="utf-8")
    assert '"rejected": bool(line.get("rejected")),' in source
    assert '"rejectedNote": line.get("rejected_note", ""),' in source
    assert '"ocrFields": line.get("ocr_fields", ""),' in source


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
    assert "All lines in this open report are shown here" in HTML


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


def test_sync_tab_shows_pc_values_for_a_local_id_match():
    assert "function matchingPcLine(item)" in HTML
    assert "line.localId === item.localId" in HTML
    assert "function syncDisplayValues(item)" in HTML
    queue = HTML[HTML.index("function renderQueue()"):]
    queue = queue[: queue.index("function updateSyncStrip")]
    assert "const display = syncDisplayValues(item);" in queue
    assert "display.category" in queue
    assert "display.description" in queue
    assert "display.amount" in queue
    assert "When a line is on the PC, this tab shows the PC's amount, category and description." in HTML
    assert "if (item.awaitingPcUpdate) return item;" in HTML
    assert "item.awaitingPcUpdate = true;" in HTML


def test_corrected_pc_line_keeps_the_phone_receipt_by_local_id():
    detail = HTML[HTML.index("function detailLinesForReport()"):]
    detail = detail[: detail.index("function monthBand")]
    assert "const knownLocalIds = new Set(pcLines.map((x) => x.localId).filter(Boolean));" in detail
    assert "!knownLocalIds.has(x.localId)" in detail
    local_match = HTML[HTML.index("function localCaptureFor(line)"):]
    local_match = local_match[: local_match.index("function receiptPanelHtml(line)")]
    assert "if (line.localId) return queue.find((item) => item.localId === line.localId) || null;" in local_match
    panel = HTML[HTML.index("function receiptPanelHtml(line)"):]
    panel = panel[: panel.index("function openReportDetail")]
    assert "if (line.hasReceipt)" in panel
    # v3.0: a PC receipt is now openable from the phone rather than being
    # described as unreachable. "Open it in Expense Hub" is no help when you
    # are away from the PC, which is the only time you are holding the phone.
    assert "pcReceiptHtml(line)" in panel
    assert "data-view-receipt" in panel
    assert "action=receipt&name=" in panel
    assert "Review expense" in panel
    assert "isLtiReport" in panel
    assert "const reportReceipt = isLtiReport ? '' : pcReceiptHtml(line);" in panel


def test_pc_corrected_values_are_used_by_the_edit_form():
    edit = HTML[HTML.index("function openForEdit(localId)"):]
    edit = edit[: edit.index("// 2026-08-02 ruling")]
    assert "const pc = matchingPcLine(item);" in edit
    assert "const source = pc && !item.awaitingPcUpdate" in edit
    assert "amount: pc.amount ?? item.amount" in edit
    assert "document.getElementById('f-amount').value = source.amount || '';" in edit
    assert "reportRef: line.reportRef || ''" in HTML


def test_sync_rows_are_grouped_by_report_type_and_name():
    queue = HTML[HTML.index("function renderQueue()"):]
    queue = queue[: queue.index("function updateSyncStrip")]
    assert "const groupLabel = (item)" in queue
    assert "const type = String(item.reportType" in queue
    assert "return `${type}" in queue
    assert "ordered = list.slice().sort" in queue
    assert "html += `<div class=\"band\">${escapeHtml(group)}</div>`" in queue


def test_phone_typed_report_is_visible_while_the_pc_creates_it():
    assert "const PENDING_REPORTS_KEY = 'eh_mobile_pending_reports';" in HTML
    assert "function rememberLocalReport(item)" in HTML
    assert "status: 'Waiting for PC'" in HTML
    assert "function reconcileLocalReports(remote)" in HTML
    assert "const openAttrs = r.reportRef ?" in HTML
    assert "function reportListSummary(report)" in HTML
    assert "Total unavailable until the PC expense list is synced" in HTML


def test_last_report_is_preselected_after_a_save():
    assert "const LAST_REPORT_KEY = 'eh_mobile_last_report';" in HTML
    assert "function rememberLastReport(item)" in HTML
    assert "function restoreLastReport()" in HTML
    assert "rememberLastReport(item);" in HTML
    assert "restoreLastReport();" in HTML


def test_scan_status_is_visible_inside_the_open_expense_until_done():
    assert 'id="capture-scan-status"' in HTML
    assert "function renderCaptureScanStatus(item)" in HTML
    assert "renderCaptureScanStatus(item);" in HTML
    scan = HTML[HTML.index("function scanStatusMarkup(item)"):]
    assert "return '';" in scan[:700]


def test_unfiled_queue_group_is_last_and_report_lines_have_a_scan_icon():
    queue = HTML[HTML.index("function renderQueue()"):]
    queue = queue[: queue.index("function updateSyncStrip")]
    assert "noTypeNoReport" in queue
    assert "Number(noTypeNoReport(a)) - Number(noTypeNoReport(b))" in queue
    assert "scanned-ico" in HTML
    assert "title=\"Scanned\"" in HTML


def test_amount_currency_row_gives_currency_enough_room_for_its_marker():
    assert 'class="row amount-row"' in HTML
    assert 'class="field currency-field"' in HTML
    assert ".amount-row .currency-field { flex: 0 0 128px; }" in HTML
    assert ".amount-row .currency-field label { white-space: nowrap;" in HTML
