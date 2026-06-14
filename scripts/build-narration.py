#!/usr/bin/env python3
"""
Build narration audio + burned-in subtitles for the recorded demo.

Reads:
  test-results/demo-record-offramp-demo-walkthrough/video.webm
  test-results/demo-record-offramp-demo-walkthrough/beats.json

Writes:
  docs/media/offramp-demo.mp4  (H.264 / AAC, narration + burned-in subtitles)
"""
import json
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
REC_DIR = REPO / "test-results" / "demo-record-offramp-demo-walkthrough"
BEATS_JSON = REC_DIR / "beats.json"
OUT_DIR = REPO / "docs" / "media"
OUT_MP4 = OUT_DIR / "offramp-demo.mp4"
TTS_DIR = REC_DIR / "tts"

VOICE = os.environ.get("DEMO_TTS_VOICE", "en-US-AndrewNeural")
RATE = os.environ.get("DEMO_TTS_RATE", "+5%")  # very slight speed-up; reads more crisply

# Video resolution (matches Playwright recordVideo size; used for ASS PlayRes).
W, H = 1280, 900

# ---- subtitle styling -----------------------------------------------------------------
ASS_HEADER = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,30,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,40,40,40,1
Style: Sub,DejaVu Sans,22,&H00E3D4FF,&H000000FF,&H00000000,&H80000000,0,1,0,0,100,100,0,0,1,2,1,2,40,40,8,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def ms_to_ass(ms: int) -> str:
    h = ms // 3_600_000
    m = (ms % 3_600_000) // 60_000
    s = (ms % 60_000) // 1000
    cs = (ms % 1000) // 10
    return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"


def ffprobe_duration_ms(path: Path) -> int:
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        text=True,
    ).strip()
    return int(float(out) * 1000)


def tts_one(text: str, dest: Path) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["python3", "-m", "edge_tts", "--voice", VOICE, "--rate", RATE,
         "--text", text, "--write-media", str(dest)],
        check=True,
    )
    return ffprobe_duration_ms(dest)


def main():
    if not BEATS_JSON.exists():
        sys.exit(f"beats.json not found at {BEATS_JSON}; run scripts/record-demo.mjs first")

    meta = json.loads(BEATS_JSON.read_text())
    beats = meta["beats"]
    video_file = REC_DIR / meta["videoFile"]
    total_video_ms = ffprobe_duration_ms(video_file)
    print(f"[narration] video: {video_file.name} ({total_video_ms} ms)")

    # ---- 1. Generate per-beat TTS, get durations -------------------------------------
    TTS_DIR.mkdir(parents=True, exist_ok=True)
    for i, b in enumerate(beats):
        mp3 = TTS_DIR / f"{i:02d}-{b['id']}.mp3"
        if mp3.exists():
            mp3.unlink()
        dur = tts_one(b["narration"], mp3)
        b["audioFile"] = str(mp3)
        b["audioMs"] = dur
        print(f"  beat {i:02d} {b['id']:<14} → {dur}ms  (slot {b['startMs']}–{b['endMs']}ms = {b['endMs']-b['startMs']}ms)")

    # ---- 2. Build a single narration track aligned to beat starts --------------------
    # Use ffmpeg: -i each mp3, adelay each by beat['startMs'], amix all together.
    inputs = []
    filter_parts = []
    for i, b in enumerate(beats):
        inputs.extend(["-i", b["audioFile"]])
        delay = b["startMs"]
        filter_parts.append(f"[{i}:a]adelay={delay}|{delay}[a{i}]")
    amix_inputs = "".join(f"[a{i}]" for i in range(len(beats)))
    filter_complex = ";".join(filter_parts) + f";{amix_inputs}amix=inputs={len(beats)}:duration=longest:normalize=0[mix]"

    audio_wav = REC_DIR / "narration.wav"
    if audio_wav.exists():
        audio_wav.unlink()
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "warning",
         *inputs,
         "-filter_complex", filter_complex,
         "-map", "[mix]",
         "-ar", "44100", "-ac", "2",
         str(audio_wav)],
        check=True,
    )
    print(f"[narration] mixed audio → {audio_wav}")

    # ---- 3. Write ASS subtitles ------------------------------------------------------
    ass_path = REC_DIR / "captions.ass"
    lines = [ASS_HEADER]
    for b in beats:
        start = ms_to_ass(b["startMs"])
        end = ms_to_ass(min(b["endMs"], total_video_ms))
        # Escape ASS-special chars in caption text.
        caption = b["caption"].replace("{", "\\{").replace("}", "\\}").replace("\n", "\\N")
        lines.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{caption}")
    ass_path.write_text("\n".join(lines))
    print(f"[narration] wrote {ass_path}")

    # ---- 4. Mux video + audio + burn subs into mp4 -----------------------------------
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if OUT_MP4.exists():
        OUT_MP4.unlink()
    # ass filter needs the file path. Escape the colon for the filter syntax.
    ass_arg = str(ass_path).replace(":", "\\:")
    cmd = [
        "ffmpeg", "-y", "-loglevel", "warning",
        "-i", str(video_file),
        "-i", str(audio_wav),
        "-filter_complex", f"[0:v]ass='{ass_arg}'[v]",
        "-map", "[v]", "-map", "1:a",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
        "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart",
        "-shortest",
        str(OUT_MP4),
    ]
    print("[narration] ffmpeg mux + burn subs ...")
    subprocess.run(cmd, check=True)

    final_dur = ffprobe_duration_ms(OUT_MP4)
    final_size = OUT_MP4.stat().st_size
    print(f"[narration] DONE: {OUT_MP4} ({final_dur} ms, {final_size:,} bytes)")


if __name__ == "__main__":
    main()
