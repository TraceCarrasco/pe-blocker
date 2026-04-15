"""
Generates Private Equity Watch extension icons using Pillow.

Default state : dark navy background, white eye symbol
Safe state    : green background, white checkmark
Warning state : red background, bold white "$" text

Run once: python3 generate-icons.py
Requires: pip install pillow
"""

import math
import os
from PIL import Image, ImageDraw, ImageFont

os.makedirs("icons", exist_ok=True)

# ── Palette ──────────────────────────────────────────────────────────────────
BG_DEFAULT = (15,  23,  42,  255)   # #0f172a — dark navy
BG_SAFE    = (21,  128, 61,  255)   # #15803d — forest green
BG_WARN    = (185, 28,  28,  255)   # #b91c1c — deep red
WHITE      = (255, 255, 255, 255)
TRANSPARENT = (0,  0,   0,   0)

# ── Font ─────────────────────────────────────────────────────────────────────
FONT_PATH = "/System/Library/Fonts/HelveticaNeue.ttc"
FONT_BOLD_INDEX = 1   # index 1 = Helvetica Neue Bold


def load_bold(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_PATH, size, index=FONT_BOLD_INDEX)


# ── Helpers ───────────────────────────────────────────────────────────────────

def rounded_rect_mask(size: int, radius: int) -> Image.Image:
    """Alpha mask with rounded corners so the final icon clips cleanly."""
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=radius, fill=255)
    return mask


def eye_polygon(cx: float, cy: float, w: float, h: float, n: int = 64):
    """
    Return points for a lens/almond (eye) shape.
    The formula uses a raised-sine to sharpen the tips compared with a plain ellipse.
    """
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        # sin raised to a power < 1 pulls tips inward → pointier ends
        x = cx + (w / 2) * math.cos(t)
        y = cy - (h / 2) * math.copysign(abs(math.sin(t)) ** 0.65, math.sin(t))
        pts.append((x, y))
    return pts


# ── Icon generators ───────────────────────────────────────────────────────────

def make_default(target: int) -> Image.Image:
    """
    Dark navy background with two white eye symbols side-by-side (👀 style):
      • Two filled white lens shapes
      • Dark iris + white ring + dark pupil + highlight in each eye
    """
    OVER = 4          # super-sampling factor for clean anti-aliasing
    s = target * OVER

    img = Image.new("RGBA", (s, s), TRANSPARENT)
    draw = ImageDraw.Draw(img)

    # Background
    draw.rectangle([(0, 0), (s, s)], fill=BG_DEFAULT)

    # ── Two-eye (👀) geometry ─────────────────────────────────────────────
    pad = s * 0.08                       # outer horizontal padding
    gap = s * 0.08                       # gap between the two eyes
    ew  = (s - 2 * pad - gap) / 2       # width of each eye
    eh  = ew * 1.20                      # taller than wide (portrait aspect)
    cy  = s / 2                          # vertically centred

    lcx = pad + ew / 2                   # left eye centre x
    rcx = s - pad - ew / 2              # right eye centre x

    # Iris shifts down inside the (centred) white lens — the white stays put,
    # the dark iris/pupil moves to the bottom half to convey a downward gaze.
    gaze_dy = eh * 0.30

    def draw_eye(cx, cy):
        # White lens — centred at (cx, cy), no offset
        pts = eye_polygon(cx, cy, ew, eh, n=128)
        draw.polygon(pts, fill=WHITE)

        # Iris centre shifted downward within the lens
        icy = cy + gaze_dy -20

        # Iris — dark navy circle
        iris_r = eh * 0.44
        draw.ellipse(
            [(cx - iris_r, icy - iris_r), (cx + iris_r, icy + iris_r)],
            fill=BG_DEFAULT,
        )

        # Inner iris ring — white ring to separate iris from eye white
        ring_r = iris_r * 0.82
        draw.ellipse(
            [(cx - ring_r, icy - ring_r), (cx + ring_r, icy + ring_r)],
            fill=WHITE,
        )

        # Pupil — dark filled circle
        pupil_r = ring_r * 0.58
        iris_offset_x = 10
        iris_offset_y = 5
        draw.ellipse(
            [(cx - pupil_r - iris_offset_x, icy - pupil_r - iris_offset_y), (cx + pupil_r - 6, icy + pupil_r + 10)],
            fill=BG_DEFAULT,
        )

        # Highlight dot — small white circle offset up-right from pupil centre
        hl_r  = pupil_r * 0.38
        hl_ox = pupil_r * 0.001
        hl_oy = pupil_r * 0.001
        draw.ellipse(
            [
                (cx + hl_ox - hl_r - 10, icy - hl_oy - hl_r+4),
                (cx + hl_ox + hl_r - 10 , icy - hl_oy + hl_r + 10),
            ],
            fill=WHITE,
        )

    draw_eye(lcx, cy)
    draw_eye(rcx, cy)

    # ── Downscale with anti-aliasing ──────────────────────────────────────
    img = img.resize((target, target), Image.LANCZOS)

    # Apply rounded-corner mask
    mask = rounded_rect_mask(target, radius=max(2, target // 5))
    img.putalpha(mask)

    return img


def make_warning(target: int) -> Image.Image:
    """
    Deep red background with bold white "PE" text, centred.
    A thin white dot sits below the letters as a subtle alert accent.
    """
    OVER = 4
    s = target * OVER

    img = Image.new("RGBA", (s, s), TRANSPARENT)
    draw = ImageDraw.Draw(img)

    # Background
    draw.rectangle([(0, 0), (s, s)], fill=BG_WARN)

    # ── Typography ────────────────────────────────────────────────────────
    # Scale font to ~55 % of icon height; nudge up slightly for the dot
    font_size = int(s * 0.52)
    font = load_bold(font_size)

    text = "$"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    tx = (s - tw) / 2 - bbox[0]
    ty = (s - th) / 2 - bbox[1]

    draw.text((tx, ty), text, fill=WHITE, font=font)

    # ── Downscale ─────────────────────────────────────────────────────────
    img = img.resize((target, target), Image.LANCZOS)

    mask = rounded_rect_mask(target, radius=max(2, target // 5))
    img.putalpha(mask)

    return img


def make_safe(target: int) -> Image.Image:
    """
    Forest green background with a bold white checkmark, centred.
    """
    OVER = 4
    s = target * OVER

    img = Image.new("RGBA", (s, s), TRANSPARENT)
    draw = ImageDraw.Draw(img)

    # Background
    draw.rectangle([(0, 0), (s, s)], fill=BG_SAFE)

    # ── Checkmark geometry ────────────────────────────────────────────────
    # Three points defining the tick: left foot → valley → right tip
    # Proportions tuned to look balanced and centred inside the icon.
    pad = s * 0.20
    lx = pad                       # left foot  x
    ly = s * 0.54                  # left foot  y
    mx = s * 0.42                  # valley     x
    my = s * 0.72                  # valley     y  (lowest point)
    rx = s - pad                   # right tip  x
    ry = s * 0.28                  # right tip  y

    stroke = max(2, int(s * 0.115))

    # Draw as two thick line segments with round caps for smoothness
    draw.line([(lx, ly), (mx, my)], fill=WHITE, width=stroke)
    draw.line([(mx, my), (rx, ry)], fill=WHITE, width=stroke)

    # Round caps at each endpoint and the valley join
    r = stroke // 2
    for px, py in [(lx, ly), (mx, my), (rx, ry)]:
        draw.ellipse([(px - r, py - r), (px + r, py + r)], fill=WHITE)

    # ── Downscale ─────────────────────────────────────────────────────────
    img = img.resize((target, target), Image.LANCZOS)

    mask = rounded_rect_mask(target, radius=max(2, target // 5))
    img.putalpha(mask)

    return img


# ── Generate all sizes ────────────────────────────────────────────────────────

for size in (16, 48, 128):
    default_path = f"icons/icon{size}.png"
    safe_path    = f"icons/icon-safe{size}.png"
    warning_path = f"icons/icon-warning{size}.png"

    make_default(size).save(default_path)
    make_safe(size).save(safe_path)
    make_warning(size).save(warning_path)

    print(f"  {default_path}  +  {safe_path}  +  {warning_path}")

print("Done.")
