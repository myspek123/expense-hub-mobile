"""Audit gaps: behaviour the audit asks for that had no test of its own.

Same style as test_mobile_html.py -- index.html is one file, so these assert
against its source.
"""
from __future__ import annotations

from pathlib import Path


HTML = (Path(__file__).parents[1] / "index.html").read_text(encoding="utf-8")


def _add_many_handler() -> str:
    handler = HTML[HTML.index("document.getElementById('f-many').addEventListener") :]
    return handler[: handler.index("document.getElementById('btn-save')")]


# -- Add many keeps the report the user chose ------------------------------


def test_add_many_carries_the_selected_report_ref():
    """The chosen report is the ONE thing Add many must not lose.

    Every other field is deliberately blank for the PC scan to fill. The report
    is not scannable: if the ref does not travel, the whole batch lands Unfiled
    and the user has to re-file each one by hand.
    """
    handler = _add_many_handler()
    assert "reportRef: selectedReportRef" in handler
    assert "reportType: reportType" in handler
    assert "reportName: reportName" in handler


def test_add_many_reads_the_report_from_the_form_before_the_loop():
    """Read once, outside the loop, so every photo in the batch gets the same
    report -- not whatever the form happens to hold by photo thirty."""
    handler = _add_many_handler()
    type_at = handler.index("const reportType = document.getElementById('f-report-type').value")
    loop_at = handler.index("for (const [index, file] of files.entries())")
    assert type_at < loop_at


def test_a_report_ref_is_only_ever_set_by_picking_a_suggestion():
    """Typed text must not be guessed into a ref. Both edit paths clear it."""
    assert "selectedReportRef = btn.dataset.ref;" in HTML
    # changing the type, and typing into the name, both invalidate the pick
    typed = HTML[HTML.index("document.getElementById('f-report-name').addEventListener('input'") :]
    assert "selectedReportRef = '';" in typed[:400]


# -- non-EUR lines: the euro value, the marker, and the exclusion -----------


def test_a_non_euro_line_shows_paid_currency_and_its_euro_value():
    render = HTML[HTML.index("function reportLineAmountHtml(line)") :]
    render = render[: render.index("function localLinesForReport")]
    # £5,25 (€6,11 est.) -- paid value first, euro value in the small tag
    assert "const paid = phoneMoney(line.amount, currency)" in render
    assert "if (currency === 'EUR') return escapeHtml(paid);" in render
    assert "line.eurEstimated ? ' est.' : ''" in render


def test_an_estimated_euro_value_is_marked_and_a_confirmed_one_is_not():
    """The marker is conditional on eurEstimated, not printed on every line."""
    render = HTML[HTML.index("function reportLineAmountHtml(line)") :]
    render = render[: render.index("function localLinesForReport")]
    assert "line.eurEstimated ? ' est.' : ''" in render
    # the only ' est.' in the renderer is the one behind that condition
    assert render.count("' est.'") == 1


def test_a_non_euro_line_with_no_euro_value_says_so_instead_of_guessing():
    render = HTML[HTML.index("function reportLineAmountHtml(line)") :]
    render = render[: render.index("function localLinesForReport")]
    assert "(no EUR value)" in render
    # and the value it fails to find is null, never a silent zero
    eur = HTML[HTML.index("function reportEurAmount(line)") :]
    eur = eur[: eur.index("const PHONE_CURRENCY_SYMBOL")]
    assert "return null;" in eur


def test_a_line_with_no_euro_value_is_left_out_of_the_total_not_counted_as_zero():
    """?? 0 adds nothing for a null line; the count below is how the user is
    told the total is short."""
    detail = HTML[HTML.index("const missingEurCount = filtered.filter(") :]
    detail = detail[: detail.index("const shown = filtered.slice(")]
    assert "reportEurAmount(x) === null" in detail
    assert "sum + (reportEurAmount(x) ?? 0)" in detail


def test_the_number_of_excluded_lines_is_shown_next_to_the_total():
    detail = HTML[HTML.index("const missingEurCount = filtered.filter(") :]
    detail = detail[: detail.index("const shown = filtered.slice(")]
    assert "missing EUR" in detail
    assert "report-detail-total" in detail
    assert "${missingEurLabel}" in detail


def test_the_report_list_summary_counts_missing_euro_lines_the_same_way():
    """The list and the detail view must not disagree about one report."""
    summary = HTML[HTML.index("function reportListSummary(report)") :]
    summary = summary[: summary.index("const PHONE_CURRENCY_SYMBOL")] \
        if "const PHONE_CURRENCY_SYMBOL" in summary[:6000] else summary[:3000]
    assert "missingEurCount: lines.filter((line) => reportEurAmount(line) === null).length" in summary
    assert "sum + (reportEurAmount(line) ?? 0)" in summary


# -- version and deployment -------------------------------------------------


def test_the_offline_apps_script_version_reads_unknown_not_blank():
    assert "deployedScriptVersion = 'unknown'" in HTML
    assert 'id="script-version"' in HTML
    assert "Apps Script unknown" in HTML
