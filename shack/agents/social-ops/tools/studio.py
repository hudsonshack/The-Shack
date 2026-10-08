#!/usr/bin/env python3
"""Lumi's studio: turn raw phone photos and clips into post-ready content.

Three commands, used in order:

  studio.py review RAW_DIR OUT_DIR
      Contact sheets (one image per clip, 8 frames with timestamps) and photo
      thumbnails, so Claude can look at the footage and pick moments.
      Also writes OUT_DIR/inventory.json (durations, sizes, orientation).

  studio.py photos RAW_DIR OUT_DIR [--warmth 1.04] [--names a.jpg,b.jpg]
      Edits photos: fixes orientation, gentle contrast/colour/sharpness lift,
      and exports Instagram feed (4:5, 1080x1350) and story (9:16, 1080x1920) crops.

  studio.py reel PLAN.json OUT.mp4
      Renders a vertical 1080x1920 reel from an edit plan:
        {"clips": [{"file": "raw/IMG_01.MOV", "start": 2.0, "end": 4.5,
                    "text": "Fresh every morning"}],
         "title": "Angie's · Cold Spring", "end_card": "Come say hi",
         "fps": 30}
      On-screen text: plain words only (the fonts have no emoji).
      Each clip is cropped/fit to 9:16, colour-lifted, cross-faded, with optional
      on-screen text. Original audio is kept quietly; add licensed music in the
      Instagram/TikTok app when posting.
"""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont, ImageOps

VIDEO = {".mov", ".mp4", ".m4v", ".avi", ".mkv"}
PHOTO = {".jpg", ".jpeg", ".png", ".heic", ".webp"}
FONT = next((p for p in ["/usr/share/fonts/opentype/inter/Inter-Bold.otf",
                         "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"] if Path(p).exists()), None)
W, H = 1080, 1920


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"command failed: {' '.join(cmd[:6])}...\n{r.stderr[-1500:]}")
    return r.stdout


def probe(path):
    out = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)])
    j = json.loads(out)
    v = next((s for s in j["streams"] if s["codec_type"] == "video"), {})
    w, h = int(v.get("width", 0)), int(v.get("height", 0))
    rot = 0
    for sd in v.get("side_data_list", []) or []:
        if "rotation" in sd:
            rot = int(sd["rotation"])
    if abs(rot) in (90, 270):
        w, h = h, w
    return {"duration": float(j["format"].get("duration", 0)), "width": w, "height": h,
            "has_audio": any(s["codec_type"] == "audio" for s in j["streams"])}


def font(size):
    return ImageFont.truetype(FONT, size) if FONT else ImageFont.load_default()


def review(raw, out):
    raw, out = Path(raw), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    inv = []
    for f in sorted(raw.iterdir()):
        ext = f.suffix.lower()
        if ext in VIDEO:
            info = probe(f)
            n = 8
            frames = []
            for i in range(n):
                t = info["duration"] * (i + 0.5) / n
                tmp = out / f".frame_{i}.jpg"
                run(["ffmpeg", "-y", "-v", "error", "-ss", f"{t:.2f}", "-i", str(f), "-frames:v", "1",
                     "-vf", "scale=320:-2", str(tmp)])
                frames.append((t, Image.open(tmp).convert("RGB")))
                tmp.unlink()
            fw, fh = frames[0][1].size
            sheet = Image.new("RGB", (fw * 4, (fh + 28) * 2), "#111")
            d = ImageDraw.Draw(sheet)
            for i, (t, im) in enumerate(frames):
                x, y = (i % 4) * fw, (i // 4) * (fh + 28)
                sheet.paste(im, (x, y + 28))
                d.text((x + 6, y + 4), f"{f.name}  {t:5.1f}s", fill="#fff", font=font(18))
            sheet.save(out / f"sheet_{f.stem}.jpg", quality=85)
            inv.append({"file": f.name, "type": "video", **info})
        elif ext in PHOTO:
            im = ImageOps.exif_transpose(Image.open(f)).convert("RGB")
            im.thumbnail((640, 640))
            im.save(out / f"thumb_{f.stem}.jpg", quality=85)
            inv.append({"file": f.name, "type": "photo", "width": im.width, "height": im.height})
    (out / "inventory.json").write_text(json.dumps(inv, indent=2))
    print(json.dumps(inv, indent=2))


def crop_to(im, ratio_w, ratio_h, size):
    target = ratio_w / ratio_h
    w, h = im.size
    if w / h > target:
        nw = int(h * target); x = (w - nw) // 2; im = im.crop((x, 0, x + nw, h))
    else:
        nh = int(w / target); y = (h - nh) // 2; im = im.crop((0, y, w, y + nh))
    return im.resize(size, Image.LANCZOS)


def photos(raw, out, warmth=1.04, names=None):
    raw, out = Path(raw), Path(out)
    (out / "feed").mkdir(parents=True, exist_ok=True)
    (out / "story").mkdir(parents=True, exist_ok=True)
    done = []
    for f in sorted(raw.iterdir()):
        if f.suffix.lower() not in PHOTO or (names and f.name not in names):
            continue
        im = ImageOps.exif_transpose(Image.open(f)).convert("RGB")
        im = ImageOps.autocontrast(im, cutoff=0.5)
        im = ImageEnhance.Contrast(im).enhance(1.06)
        im = ImageEnhance.Color(im).enhance(1.12)
        im = ImageEnhance.Sharpness(im).enhance(1.15)
        r, g, b = im.split()
        r = r.point(lambda v: min(255, int(v * warmth)))
        b = b.point(lambda v: int(v / warmth))
        im = Image.merge("RGB", (r, g, b))
        crop_to(im, 4, 5, (1080, 1350)).save(out / "feed" / f"{f.stem}_feed.jpg", quality=92)
        crop_to(im, 9, 16, (1080, 1920)).save(out / "story" / f"{f.stem}_story.jpg", quality=92)
        done.append(f.name)
    print(f"edited {len(done)} photos -> {out}/feed and {out}/story")


def text_overlay(text, path):
    """Transparent 1080x1920 PNG with a caption bar near the bottom third."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = font(64)
    words, lines, line = text.split(), [], ""
    for w in words:
        test = (line + " " + w).strip()
        if d.textlength(test, font=f) > W - 160 and line:
            lines.append(line); line = w
        else:
            line = test
    lines.append(line)
    lh = 80
    y0 = int(H * 0.70) - len(lines) * lh // 2
    for i, ln in enumerate(lines):
        tw = d.textlength(ln, font=f)
        x, y = (W - tw) / 2, y0 + i * lh
        d.rounded_rectangle((x - 24, y - 8, x + tw + 24, y + lh - 6), radius=18, fill=(0, 0, 0, 150))
        d.text((x, y), ln, font=f, fill=(255, 255, 255, 255))
    img.save(path)


def reel(plan_path, out_path):
    plan = json.loads(Path(plan_path).read_text())
    base = Path(plan_path).parent
    fps = plan.get("fps", 30)
    xf = 0.35
    tmpdir = Path(out_path).with_suffix("")
    tmpdir.mkdir(parents=True, exist_ok=True)
    segs = []
    clips = list(plan["clips"])
    if plan.get("title"):
        clips[0] = dict(clips[0], text=clips[0].get("text") or plan["title"])
    for i, c in enumerate(clips):
        src = (base / c["file"]).resolve()
        info = probe(src)
        dur = max(0.6, float(c["end"]) - float(c["start"]))
        vf = (f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
              f"eq=contrast=1.05:saturation=1.15:brightness=0.01,fps={fps},format=yuv420p")
        seg = tmpdir / f"seg{i:02d}.mp4"
        inputs = ["-ss", str(c["start"]), "-t", f"{dur:.3f}", "-i", str(src)]
        if c.get("text"):
            ov = tmpdir / f"text{i:02d}.png"
            text_overlay(c["text"], ov)
            inputs += ["-i", str(ov)]
            fc = f"[0:v]{vf}[v];[v][1:v]overlay=0:0[vo]"
        else:
            fc = f"[0:v]{vf}[vo]"
        audio = ["-map", "0:a:0", "-c:a", "aac", "-ar", "48000", "-ac", "2"] if info["has_audio"] else []
        cmd = ["ffmpeg", "-y", "-v", "error", *inputs]
        if not info["has_audio"]:
            cmd += ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
            audio = ["-map", f"{2 if c.get('text') else 1}:a", "-c:a", "aac", "-ar", "48000", "-ac", "2"]
        cmd += ["-filter_complex", fc, "-map", "[vo]", *audio, "-c:v", "libx264", "-preset", "medium",
                "-crf", "20", "-shortest", str(seg)]
        run(cmd)
        segs.append((seg, dur))
    if plan.get("end_card"):
        card = tmpdir / "card.png"
        img = Image.new("RGB", (W, H), plan.get("end_color", "#1b1722"))
        img.save(card)
        ov = tmpdir / "cardtext.png"; text_overlay(plan["end_card"], ov)
        seg = tmpdir / "seg_end.mp4"
        run(["ffmpeg", "-y", "-v", "error", "-loop", "1", "-t", "2.2", "-i", str(card), "-i", str(ov),
             "-f", "lavfi", "-t", "2.2", "-i", "anullsrc=r=48000:cl=stereo",
             "-filter_complex", f"[0:v][1:v]overlay=0:-300,fps={fps},format=yuv420p[vo]",
             "-map", "[vo]", "-map", "2:a", "-c:v", "libx264", "-crf", "20", "-c:a", "aac", "-shortest", str(seg)])
        segs.append((seg, 2.2))
    # Cross-fade everything together.
    cmd = ["ffmpeg", "-y", "-v", "error"]
    for s, _ in segs:
        cmd += ["-i", str(s)]
    if len(segs) == 1:
        run(cmd + ["-c", "copy", str(out_path)])
    else:
        fv, fa, off, lv, la = [], [], 0.0, "[0:v]", "[0:a]"
        for i in range(1, len(segs)):
            off += segs[i - 1][1] - xf
            nv, na = f"[v{i}]", f"[a{i}]"
            fv.append(f"{lv}[{i}:v]xfade=transition=fade:duration={xf}:offset={off:.3f}{nv}")
            fa.append(f"{la}[{i}:a]acrossfade=d={xf}{na}")
            lv, la = nv, na
        fa.append(f"{la}volume=0.6[aout]")
        run(cmd + ["-filter_complex", ";".join(fv + fa), "-map", lv, "-map", "[aout]",
                   "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-movflags", "+faststart",
                   "-c:a", "aac", str(out_path)])
    info = probe(out_path)
    print(json.dumps({"out": str(out_path), **info}))


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    if a[0] == "review":
        review(a[1], a[2])
    elif a[0] == "photos":
        opts = dict(zip(a[3::2], a[4::2]))
        photos(a[1], a[2], float(opts.get("--warmth", 1.04)),
               opts["--names"].split(",") if "--names" in opts else None)
    elif a[0] == "reel":
        reel(a[1], a[2])
    else:
        sys.exit(__doc__)
