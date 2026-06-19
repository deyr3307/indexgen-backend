"""
Assignment Index PDF Generator — Backend Server
================================================
POST /generate-index
    Body (JSON):
    {
        "title": "Assignment Title (optional)",
        "topics": [
            "Topic One",
            "Topic Two",
            ...
        ]
    }

    Returns: PDF file as binary response

GET /health
    Returns: {"status": "ok"}

Usage example:
    curl -X POST http://localhost:5000/generate-index \
         -H "Content-Type: application/json" \
         -d '{"title":"My Assignment","topics":["Ecdysis","Air Sac","Corals"]}' \
         --output index.pdf
"""

import io
from flask import Flask, request, jsonify, send_file

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT

app = Flask(__name__)


# ─────────────────────────────────────────────
#  Core PDF builder
# ─────────────────────────────────────────────

def generate_index_pdf(topics: list[str], title: str = "INDEX") -> bytes:
    """
    Build an index PDF from a list of topic strings.

    Args:
        topics : list of topic/particular strings (in order)
        title  : heading text printed at top of the page

    Returns:
        PDF as bytes
    """
    buffer = io.BytesIO()

    # ── Page layout ──────────────────────────
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=2.5 * cm,
        rightMargin=2.5 * cm,
        topMargin=2.5 * cm,
        bottomMargin=2.5 * cm,
    )

    # ── Paragraph styles ─────────────────────
    title_style = ParagraphStyle(
        "IndexTitle",
        fontName="Times-Bold",
        fontSize=16,
        alignment=TA_CENTER,
        spaceAfter=16,
    )

    header_style = ParagraphStyle(
        "HeaderCell",
        fontName="Times-Bold",
        fontSize=11,
        alignment=TA_CENTER,
        leading=14,
    )

    sr_style = ParagraphStyle(
        "SrCell",
        fontName="Times-Roman",
        fontSize=11,
        alignment=TA_CENTER,
        leading=14,
    )

    particular_style = ParagraphStyle(
        "ParticularCell",
        fontName="Times-Roman",
        fontSize=11,
        alignment=TA_LEFT,
        leading=14,
    )

    # ── Table data ────────────────────────────
    # Header row
    table_data = [[
        Paragraph("Sr. No.", header_style),
        Paragraph("Particulars", header_style),
        Paragraph("Page No.", header_style),
    ]]

    # Data rows — auto-numbered
    for i, topic in enumerate(topics, start=1):
        table_data.append([
            Paragraph(f"{i}.", sr_style),
            Paragraph(topic, particular_style),
            Paragraph("", sr_style),          # blank — student fills manually
        ])

    # ── Column widths ─────────────────────────
    page_width = A4[0] - 2.5 * cm - 2.5 * cm
    col_widths = [
        page_width * 0.10,   # Sr. No.
        page_width * 0.74,   # Particulars
        page_width * 0.16,   # Page No.
    ]

    # ── Row heights ───────────────────────────
    row_heights = [1.1 * cm] + [1.05 * cm] * len(topics)

    table = Table(
        table_data,
        colWidths=col_widths,
        rowHeights=row_heights,
        repeatRows=1,           # repeat header on every page
    )

    # ── Table style ───────────────────────────
    table.setStyle(TableStyle([
        # Outer border + inner grid
        ("BOX",            (0, 0), (-1, -1), 1.2, colors.black),
        ("GRID",           (0, 0), (-1, -1), 0.8, colors.black),

        # Header row
        ("BACKGROUND",     (0, 0), (-1,  0), colors.white),
        ("ALIGN",          (0, 0), (-1,  0), "CENTER"),
        ("VALIGN",         (0, 0), (-1,  0), "MIDDLE"),

        # Data rows
        ("BACKGROUND",     (0, 1), (-1, -1), colors.white),
        ("ALIGN",          (0, 1), (0,  -1), "CENTER"),   # Sr. No.
        ("ALIGN",          (1, 1), (1,  -1), "LEFT"),     # Particulars
        ("ALIGN",          (2, 1), (2,  -1), "CENTER"),   # Page No.
        ("VALIGN",         (0, 1), (-1, -1), "MIDDLE"),

        # Cell padding
        ("LEFTPADDING",    (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",   (0, 0), (-1, -1), 8),
        ("TOPPADDING",     (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING",  (0, 0), (-1, -1), 6),
    ]))

    # ── Build PDF ─────────────────────────────
    story = [
        Paragraph(f"<u><b>{title}</b></u>", title_style),
        table,
    ]
    doc.build(story)

    buffer.seek(0)
    return buffer.read()


# ─────────────────────────────────────────────
#  Routes
# ─────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/generate-index", methods=["POST"])
def generate_index():
    """
    Accepts JSON body:
    {
        "title":  "INDEX"          (optional, default "INDEX")
        "topics": ["Topic 1", ...]  (required)
    }
    Returns the generated PDF as a file download.
    """
    data = request.get_json(force=True, silent=True)

    if not data:
        return jsonify({"error": "Invalid JSON body"}), 400

    topics = data.get("topics")
    if not topics or not isinstance(topics, list) or len(topics) == 0:
        return jsonify({"error": "'topics' must be a non-empty list of strings"}), 400

    # Sanitise: ensure all items are strings
    topics = [str(t).strip() for t in topics if str(t).strip()]
    if not topics:
        return jsonify({"error": "All topics were empty after sanitisation"}), 400

    title = str(data.get("title", "INDEX")).strip() or "INDEX"

    try:
        pdf_bytes = generate_index_pdf(topics=topics, title=title)
    except Exception as e:
        return jsonify({"error": f"PDF generation failed: {str(e)}"}), 500

    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name="assignment_index.pdf",
    )


# ─────────────────────────────────────────────
#  Entry point
# ─────────────────────────────────────────────

if __name__ == "__main__":
    # Set debug=False for production
    app.run(host="0.0.0.0", port=5000, debug=True)
