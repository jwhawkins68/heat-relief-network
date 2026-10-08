#!/usr/bin/env python3
"""Turn a flyer_codes_*.csv (from scripts/generate_flyer_codes.sh) into:
  - a printable PDF of cut-out registration cards (US Letter, 10 per page,
    one page-run per cooling center), and
  - a standalone QR code image (PNG + SVG) for the flyer.

Every QR opens the same register page; the printed code is what differs.

Usage: python3 build_code_cards.py flyer_codes.csv out_dir
Needs: reportlab, Pillow
"""
import csv
import sys
from collections import OrderedDict
from datetime import datetime
from pathlib import Path

from PIL import Image
from reportlab.graphics import renderPDF
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

INK = HexColor("#1F2937")
HEAT = HexColor("#C2410C")
SOFT = HexColor("#FFF4E8")
MUTED = HexColor("#6B7280")

CARD_W, CARD_H = 4.0 * inch, 2.0 * inch
COLS, ROWS = 2, 5
MARGIN_X = (letter[0] - COLS * CARD_W) / 2
MARGIN_Y = (letter[1] - ROWS * CARD_H) / 2


def qr_matrix(url):
    w = qr.QrCodeWidget(url, barLevel="M")
    q = w.qr
    q.make()
    n = q.getModuleCount()
    return [[q.isDark(r, c) for c in range(n)] for r in range(n)]


def write_qr_files(url, out_dir):
    m = qr_matrix(url)
    n, border, scale = len(m), 4, 20
    size = (n + 2 * border) * scale
    img = Image.new("RGB", (size, size), "white")
    px = img.load()
    for r in range(n):
        for c in range(n):
            if m[r][c]:
                for dy in range(scale):
                    for dx in range(scale):
                        px[(c + border) * scale + dx, (r + border) * scale + dy] = (0, 0, 0)
    png = out_dir / "heatsafe_register_qr.png"
    img.save(png)
    rects = "".join(
        f'<rect x="{c + border}" y="{r + border}" width="1" height="1"/>'
        for r in range(n) for c in range(n) if m[r][c]
    )
    tot = n + 2 * border
    (out_dir / "heatsafe_register_qr.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {tot} {tot}" '
        f'shape-rendering="crispEdges"><rect width="{tot}" height="{tot}" fill="#fff"/>'
        f'<g fill="#000">{rects}</g></svg>'
    )
    return png


def draw_qr(c, url, x, y, size):
    w = qr.QrCodeWidget(url, barLevel="M")
    x0, y0, x1, y1 = w.getBounds()
    d = Drawing(size, size, transform=[size / (x1 - x0), 0, 0, size / (y1 - y0), 0, 0])
    d.add(w)
    renderPDF.draw(d, c, x, y)


def short_url(url):
    return url.replace("http://", "").replace("https://", "")


def fmt_expiry(iso):
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%b %-d, %Y")
    except ValueError:
        return iso[:10]


def draw_card(c, x, y, site, city, code, expires, url, n, total):
    # y is the bottom-left corner of the card
    c.setFillColor(white)
    c.rect(x, y, CARD_W, CARD_H, stroke=0, fill=1)
    # header band
    band = 0.5 * inch
    c.setFillColor(HEAT)
    c.rect(x, y + CARD_H - band, CARD_W, band, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 10.5)
    c.drawString(x + 0.14 * inch, y + CARD_H - 0.22 * inch, "HeatSafe Priority Access")
    c.setFont("Helvetica", 8)
    c.drawString(x + 0.14 * inch, y + CARD_H - 0.39 * inch, f"{site}, {city}")

    # QR
    qs = 1.12 * inch
    qx, qy = x + 0.2 * inch, y + 0.3 * inch
    draw_qr(c, url, qx, qy, qs)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 6.5)
    c.drawCentredString(qx + qs / 2, y + 0.16 * inch, "Scan with your phone camera")

    # right column
    rx = x + 1.62 * inch
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 7.5)
    c.drawString(rx, y + 1.3 * inch, "YOUR REGISTRATION CODE")
    # code drawn glyph by glyph (fixed pitch, small gap mid-code) so it is easy
    # to read aloud or type; the gap is NOT a character - type all 8 together.
    c.setFillColor(SOFT)
    c.roundRect(rx - 0.06 * inch, y + 0.86 * inch, 2.3 * inch, 0.36 * inch, 4, stroke=0, fill=1)
    c.setFillColor(INK)
    c.setFont("Courier-Bold", 19)
    pitch = 0.255 * inch
    for i, ch in enumerate(code):
        c.drawString(rx + 0.04 * inch + i * pitch + (0.1 * inch if i >= 4 else 0), y + 0.95 * inch, ch)

    c.setFillColor(INK)
    c.setFont("Helvetica", 7.6)
    lines = [
        "1. Scan the QR code, or go to:",
        f"    {short_url(url)}",
        "2. Enter the 8-character code above",
        "3. Create your account and profile",
    ]
    ty = y + 0.7 * inch
    for i, ln in enumerate(lines):
        c.setFont("Helvetica-Bold" if i == 1 else "Helvetica", 7.6)
        c.drawString(rx, ty - i * 0.125 * inch, ln)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 6.3)
    c.drawString(rx, y + 0.1 * inch, f"One use only  |  Expires {fmt_expiry(expires)}")
    c.drawRightString(x + CARD_W - 0.12 * inch, y + 0.1 * inch, f"{n}/{total}")


def draw_cut_guides(c):
    c.setStrokeColor(HexColor("#9CA3AF"))
    c.setLineWidth(0.4)
    c.setDash(2, 3)
    for i in range(COLS + 1):
        x = MARGIN_X + i * CARD_W
        c.line(x, MARGIN_Y - 6, x, letter[1] - MARGIN_Y + 6)
    for j in range(ROWS + 1):
        y = MARGIN_Y + j * CARD_H
        c.line(MARGIN_X - 6, y, letter[0] - MARGIN_X + 6, y)
    c.setDash()


def main(csv_path, out_dir):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    groups = OrderedDict()
    with open(csv_path, newline="") as f:
        for row in csv.DictReader(f):
            groups.setdefault((row["site"], row["city"]), []).append(row)
    if not groups:
        sys.exit("CSV has no codes")
    urls = {r["register_url"] for rows in groups.values() for r in rows}
    if len(urls) != 1:
        sys.exit(f"CSV mixes different register URLs: {urls}")
    url = urls.pop()

    write_qr_files(url, out_dir)

    pdf_path = out_dir / "HeatSafe_Registration_Cards.pdf"
    c = canvas.Canvas(str(pdf_path), pagesize=letter)
    c.setTitle("HeatSafe registration cards")
    c.setAuthor("HeatSafe Team 5")
    per_page = COLS * ROWS
    pages = 0
    for (site, city), rows in groups.items():
        total = len(rows)
        for start in range(0, total, per_page):
            draw_cut_guides(c)
            for k, row in enumerate(rows[start:start + per_page]):
                col, rr = k % COLS, k // COLS
                x = MARGIN_X + col * CARD_W
                y = letter[1] - MARGIN_Y - (rr + 1) * CARD_H
                draw_card(c, x, y, site, city, row["code"], row["expires_at"], url, start + k + 1, total)
            c.showPage()
            pages += 1
    c.save()
    print(f"{sum(len(r) for r in groups.values())} cards, {pages} pages -> {pdf_path}")
    print(f"QR points to {url}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
