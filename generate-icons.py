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
    Kilroy Was Here style icon:
      • Bald head arc peeking above a wall
      • Two round eyes resting on the wall top
      • Big curved nose hanging down over the wall
    """
    OVER = 4
    s = target * OVER

    img = Image.new("RGBA", (s, s), TRANSPARENT)
    draw = ImageDraw.Draw(img)

    # Background
    draw.rectangle([(0, 0), (s, s)], fill=BG_DEFAULT)

    # ── Wall ──────────────────────────────────────────────────────────────
    wall_y   = int(s * 0.58)
    draw.rectangle([(0, wall_y), (s - 1, s - 1)], fill=(28, 45, 72, 255))
    edge_h = max(3, int(s * 0.020))
    draw.rectangle(
        [(0, wall_y - edge_h // 2), (s - 1, wall_y + edge_h // 2)],
        fill=(65, 88, 118, 255),
    )

    stroke = max(4, int(s * 0.048))

    # ── Eyes — sit right on top of the wall ───────────────────────────────
    eye_r  = int(s * 0.038)
    eye_cy = wall_y - eye_r          # bottom of each eye circle touches wall
    lcx    = int(s * 0.35)
    rcx    = int(s * 0.65)

    for ecx in [lcx, rcx]:
        draw.ellipse(
            [(ecx - eye_r, eye_cy - eye_r), (ecx + eye_r, eye_cy + eye_r)],
            fill=WHITE,
        )

    # ── Head arc — bald dome connecting the outer edges of both eyes ───────
    head_cx = s // 2
    head_rx = int(s * 0.30)   # fixed wide head, independent of eye spacing
    head_ry = int(s * 0.24)

    # PIL arc: angles clockwise from 3 o'clock. 180→360 = left→top→right (top half).
    draw.arc(
        [(head_cx - head_rx, eye_cy - head_ry),
         (head_cx + head_rx, eye_cy + head_ry)],
        start=180, end=360,
        fill=WHITE, width=stroke,
    )

    # ── Nose — big arc hanging below the wall ─────────────────────────────
    # Arc bounding box centred on wall_y so endpoints land at wall level.
    # 0→180 = right→bottom→left (bottom half = hangs downward).
    nose_cx = s // 2
    nose_rx = int(s * 0.085)
    nose_ry = int(s * 0.310)

    draw.arc(
        [(nose_cx - nose_rx, wall_y - nose_ry),
         (nose_cx + nose_rx, wall_y + nose_ry)],
        start=0, end=180,
        fill=WHITE, width=stroke,
    )

    # ── Hands — fingers gripping the wall, just outside the nose ─────────
    finger_w   = int(s * 0.033)
    finger_h   = int(s * 0.082)
    finger_gap = int(s * 0.010)
    finger_r   = finger_w // 2
    n_fingers  = 3
    hand_w     = n_fingers * finger_w + (n_fingers - 1) * finger_gap
    margin     = int(s * 0.022)   # gap between nose edge and nearest finger

    fy_top = wall_y - int(finger_h * 0.55)
    fy_bot = wall_y + int(finger_h * 0.60)

    # Left hand — anchored near the left edge of the frame
    lh_x = int(s * 0.04)
    for i in range(n_fingers):
        fx = lh_x + i * (finger_w + finger_gap)
        draw.rounded_rectangle(
            [(fx, fy_top), (fx + finger_w, fy_bot)],
            radius=finger_r, fill=WHITE,
        )

    # Right hand — anchored near the right edge of the frame
    rh_x = int(s * 0.96) - hand_w
    for i in range(n_fingers):
        fx = rh_x + i * (finger_w + finger_gap)
        draw.rounded_rectangle(
            [(fx, fy_top), (fx + finger_w, fy_bot)],
            radius=finger_r, fill=WHITE,
        )

    # ── Downscale with anti-aliasing ──────────────────────────────────────
    img = img.resize((target, target), Image.LANCZOS)
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
