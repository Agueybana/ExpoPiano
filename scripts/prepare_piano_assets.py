#!/usr/bin/env python3
"""
prepare_piano_assets.py  (self-healing upgrade)

What it does:
 - Converts a piano sample set into the exact filenames your app expects -> samples/<MIDI>.mp3
 - Normalizes level, trims silence, fades tails, resamples to 44.1 kHz mono, length clamp
 - Repairs/renames impulse responses to known names + sample rate/channels
 - If impulses are missing or invalid, procedurally GENERATES studio/medium/hall/cathedral/plate IRs
 - If your sample source folder is empty, can GENERATE placeholder piano samples (for testing)

Requirements:
  - macOS (or Linux)
  - ffmpeg in PATH  (brew install ffmpeg)

Usage:
  python3 scripts/prepare_piano_assets.py --source "/path/to/raw_piano_samples"

Optional flags:
  --samples-dir samples
  --impulses-dir impulses
  --format mp3                  (mp3 or wav)
  --length 6.0                  (seconds, max sample duration)
  --generate-placeholders yes   (yes/no) create test samples when source empty
  --roots "21,24,27,...,108"    (MIDI root notes to render)

This script writes assets-manifest.json at project root with a summary.
"""

import argparse, json, os, re, struct, subprocess, sys, shutil
from pathlib import Path
from math import sin, pi, exp
import random

NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
NAME_ALIASES = {'Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#'}

DEFAULT_ROOTS = [21,24,27,30,33,36,39,42,45,48,51,54,57,60,63,66,69,72,75,78,81,84,87,90,93,96,99,102,105,108]
AUDIO_EXTS = {'.wav','.wave','.aiff','.aif','.flac','.mp3','.m4a','.ogg','.aac'}

EXPECTED_IRS = {
  "studio.wav":      "studio.wav",
  "medium-room.wav": "medium-room.wav",
  "hall.wav":        "hall.wav",
  "cathedral.wav":   "cathedral.wav",
  "plate.wav":       "plate.wav"
}

# ----------------------------- ffmpeg utils --------------------------------

def run(cmd):
  try:
    r = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return r.stdout.decode('utf-8','ignore'), r.stderr.decode('utf-8','ignore')
  except subprocess.CalledProcessError as e:
    out = e.stdout.decode('utf-8','ignore')
    err = e.stderr.decode('utf-8','ignore')
    print(f"[ffmpeg] ERROR running: {' '.join(cmd)}\n{err}")
    raise

def have_ffmpeg():
  try:
    subprocess.run(['ffmpeg','-version'], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    subprocess.run(['ffprobe','-version'], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return True
  except Exception:
    return False

def ffprobe_ok(path: Path):
  try:
    subprocess.run(
      ['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1', str(path)],
      check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    return True
  except subprocess.CalledProcessError:
    return False

# ----------------------------- MIDI parsing --------------------------------

def midi_from_note_name(token):
  m = re.fullmatch(r'([A-Ga-g])([#b]?)(-?\d{1,2})', token.strip())
  if not m: return None
  n, accidental, octv = m.groups()
  name = n.upper() + accidental
  name = NAME_ALIASES.get(name, name)
  if name not in NOTE_NAMES: return None
  midi = NOTE_NAMES.index(name) + (int(octv)+1)*12
  return midi

def guess_midi_from_filename(fname):
  base = Path(fname).stem
  m = re.search(r'\b(\d{2,3})\b', base)
  if m:
    v = int(m.group(1))
    if 0 <= v <= 127:
      return v
  tokens = re.findall(r'([A-Ga-g][#b]?-?\d{1,2})', base)
  for tok in tokens:
    midi = midi_from_note_name(tok)
    if midi is not None: return midi
  return None

def scan_source_files(source_dir):
  files = []
  for root, _, names in os.walk(source_dir):
    for n in names:
      p = Path(root)/n
      if p.suffix.lower() in AUDIO_EXTS:
        midi = guess_midi_from_filename(n)
        files.append((p, midi))
  return files

def nearest_available(target, available_midis):
  if not available_midis: return None
  return min(available_midis, key=lambda m: abs(m-target))

# ----------------------------- File I/O ------------------------------------

def ensure_dir(p: Path):
  p.mkdir(parents=True, exist_ok=True)

def convert_with_ffmpeg(src: Path, dst: Path, mono=True, sr=44100, length_sec=6.0, out_format='mp3'):
  ensure_dir(dst.parent)
  af = [
    "highpass=f=20",
    "silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB",
    f"atrim=0:{length_sec}",
    "dynaudnorm=f=75:g=15:p=0.95",
    "volume=0.0dB",
    "afade=t=out:st={}:d=0.2".format(max(0.1, length_sec-0.2))
  ]
  ch = ["-ac","1"] if mono else []
  codec = []
  fmt = dst.suffix.lower()
  if out_format.lower() == 'mp3' or fmt == '.mp3':
    codec = ["-codec:a","libmp3lame","-qscale:a","3"]
  elif out_format.lower() == 'wav' or fmt == '.wav':
    codec = ["-codec:a","pcm_s16le"]
  else:
    raise SystemExit("Unsupported output format. Use mp3 or wav.")
  cmd = ["ffmpeg","-y","-i",str(src),"-vn","-ar",str(sr)] + ch + ["-af", ",".join(af)] + codec + [str(dst)]
  run(cmd)

# --------------------- Procedural impulse generation -----------------------

def write_wav_stereo(path: Path, dataL, dataR, sr=44100):
  ensure_dir(path.parent)
  import wave
  with wave.open(str(path), 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)  # 16-bit
    w.setframerate(sr)
    frames = bytearray()
    for i in range(len(dataL)):
      L = int(max(-1, min(1, dataL[i])) * 32767)
      R = int(max(-1, min(1, dataR[i])) * 32767)
      frames += struct.pack('<hh', L, R)
    w.writeframes(frames)

def generate_ir(name: str, sr=44100):
  """
  Simple Schroeder-ish IR: exponentially decaying colored noise + early reflections.
  Different presets tweak decay/damping/ERs for: studio, medium-room, hall, cathedral, plate.
  """
  presets = {
    'studio':      dict(decay=0.9,  seconds=0.9,  hf_decay=0.7,  early=[(6,0.6),(11,0.4)]),
    'medium-room': dict(decay=1.2,  seconds=1.5,  hf_decay=0.6,  early=[(7,0.7),(13,0.5),(23,0.35)]),
    'hall':        dict(decay=1.8,  seconds=2.6,  hf_decay=0.55, early=[(9,0.8),(17,0.6),(31,0.45),(47,0.3)]),
    'cathedral':   dict(decay=2.5,  seconds=4.2,  hf_decay=0.5,  early=[(12,0.9),(23,0.7),(41,0.55),(73,0.35),(97,0.25)]),
    'plate':       dict(decay=1.6,  seconds=1.8,  hf_decay=0.75, early=[(5,0.95),(11,0.75),(19,0.55),(29,0.35)])
  }
  p = presets.get(name, presets['medium-room'])
  N = int(sr * p['seconds'])
  nl = [0.0]*N
  nr = [0.0]*N

  # Early reflections
  for delay_ms, level in p['early']:
    off = int(sr * (delay_ms/1000.0))
    if off < N:
      nl[off] += level
      nr[max(0, off-1)] += level*0.98

  # Late reverb tail: decaying colored noise with hf damping
  rnd = random.Random(1337 + hash(name))
  env_decay = p['decay']
  hf = p['hf_decay']
  valL = 0.0
  valR = 0.0
  for i in range(N):
    # pink-ish noise
    n = (rnd.random()*2-1)
    valL = (valL + 0.05*n) / (1.05)
    valR = (valR + 0.05*(rnd.random()*2-1)) / (1.05)
    # exponential envelope
    e = exp(-i/(env_decay*sr))
    # high-frequency damping towards end
    hf_env = (1 - hf*(i/N))
    nl[i] += valL * e * hf_env * 0.6
    nr[i] += valR * e * hf_env * 0.6

  # Tiny fade to avoid clicks
  for i in range(int(sr*0.01)):
    k = i/(sr*0.01)
    nl[i] *= k; nr[i] *= k
    nl[-i-1] *= k; nr[-i-1] *= k

  return nl, nr

def ensure_impulse(impulses_dir: Path, display_name: str, filename: str):
  """
  If <filename> exists and is valid => convert to stereo 44.1kHz (in place).
  If missing or invalid => generate procedurally and write it.
  """
  target = impulses_dir/filename
  # Attempt to locate aliased names (e.g., 'yomedium-room')
  alias_patterns = {
    re.compile(r'yo?medium[-_ ]room', re.I): "medium-room.wav",
  }
  if not target.exists():
    for f in impulses_dir.glob("*.*"):
      base = f.stem
      for pat, out in alias_patterns.items():
        if pat.search(base) and out == filename:
          # rename + convert
          try:
            run(["ffmpeg","-y","-i",str(f),"-ar","44100","-ac","2",str(target)])
            if ffprobe_ok(target): return str(target)
          except Exception:
            pass

  if target.exists() and ffprobe_ok(target):
    # Normalize sr/ac
    try:
      run(["ffmpeg","-y","-i",str(target),"-ar","44100","-ac","2",str(target)])
      return str(target)
    except Exception:
      pass

  # Generate procedural IR
  name_key = filename.replace(".wav","")
  L,R = generate_ir(name_key)
  try:
    write_wav_stereo(target, L, R, sr=44100)
    return str(target)
  except Exception as e:
    print(f"[impulses] Failed to generate {filename}: {e}")
    return None

def normalize_impulses(impulses_dir: Path):
  ensure_dir(impulses_dir)
  produced = {}
  produced["studio.wav"] = ensure_impulse(impulses_dir, "Studio", "studio.wav")
  produced["medium-room.wav"] = ensure_impulse(impulses_dir, "Medium Room", "medium-room.wav")
  produced["hall.wav"] = ensure_impulse(impulses_dir, "Hall", "hall.wav")
  produced["cathedral.wav"] = ensure_impulse(impulses_dir, "Cathedral", "cathedral.wav")
  produced["plate.wav"] = ensure_impulse(impulses_dir, "Plate", "plate.wav")
  return produced

# --------------------- Placeholder piano sample generation ------------------

def midi_to_freq(m):
  return 440.0 * (2 ** ((m-69)/12.0))

def write_wav_mono(path: Path, data, sr=44100):
  ensure_dir(path.parent)
  import wave
  with wave.open(str(path), 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(sr)
    frames = bytearray()
    for i in range(len(data)):
      s = int(max(-1, min(1, data[i])) * 32767)
      frames += struct.pack('<h', s)
    w.writeframes(frames)

def generate_placeholder_note(midi: int, length=4.5, sr=44100):
  """
  Quick piano-ish placeholder:
   - additive partials (1.0, 2.0, 3.01, 4.2) with fast attack, long decay
   - soft hammer noise burst
  """
  N = int(sr*length)
  f = midi_to_freq(midi)
  y = [0.0]*N
  rnd = random.Random(2025 + midi)

  for i in range(N):
    t = i/sr
    env = min(1.0, t/0.01) * exp(-t/2.0)  # attack ~10ms, decay ~2.0s
    val = (sin(2*pi*f*t)*0.55 +
           sin(2*pi*2.0*f*t)*0.22 +
           sin(2*pi*3.01*f*t)*0.12 +
           sin(2*pi*4.2*f*t)*0.08)
    # hammer/strike noise at start
    if i < int(0.01*sr):
      val += (rnd.random()*2-1)*0.4*(1 - i/(0.01*sr))
    y[i] = val * env
  # fade tail gently
  for i in range(int(sr*0.02)):
    y[-i-1] *= i/(sr*0.02)
  return y

def ensure_placeholder_or_convert(src_map, dst_path: Path, midi: int, out_format: str, length_sec: float):
  """
  If we have a source file -> convert. Otherwise generate a placeholder WAV then convert to requested format.
  """
  if midi in src_map:
    src = src_map[midi]
    try:
      convert_with_ffmpeg(src, dst_path, mono=True, sr=44100, length_sec=length_sec, out_format=out_format)
      return True, f"converted from {src.name}"
    except Exception as e:
      return False, f"ffmpeg failed: {e}"
  else:
    # Generate placeholder WAV then (if output is mp3) transcode
    tmp_wav = dst_path.with_suffix('.wav')
    y = generate_placeholder_note(midi, length=min(4.5, length_sec))
    write_wav_mono(tmp_wav, y, sr=44100)
    if out_format.lower() == 'wav':
      # rename to expected extension
      if dst_path.suffix.lower() != '.wav':
        shutil.move(str(tmp_wav), str(dst_path))
      return True, "generated placeholder (WAV)"
    else:
      # transcode to mp3 then remove temp wav
      try:
        convert_with_ffmpeg(tmp_wav, dst_path, mono=True, sr=44100, length_sec=length_sec, out_format='mp3')
        tmp_wav.unlink(missing_ok=True)
        return True, "generated placeholder → MP3"
      except Exception as e:
        return False, f"placeholder transcode failed: {e}"

# ----------------------------- Main ----------------------------------------

def main():
  parser = argparse.ArgumentParser()
  parser.add_argument("--source", required=True, help="Folder containing raw piano samples")
  parser.add_argument("--samples-dir", default="samples", help="Output folder for generated note samples")
  parser.add_argument("--impulses-dir", default="impulses", help="Folder with impulse responses to normalize/rename")
  parser.add_argument("--format", default="mp3", choices=["mp3","wav"], help="Output audio format for samples")
  parser.add_argument("--length", type=float, default=6.0, help="Max length per sample (seconds)")
  parser.add_argument("--roots", default=",".join(map(str, DEFAULT_ROOTS)), help="Comma-separated MIDI roots to produce")
  parser.add_argument("--generate-placeholders", default="yes", choices=["yes","no"], help="When no source files, generate placeholders (keeps app usable)")
  args = parser.parse_args()

  if not have_ffmpeg():
    print("ERROR: ffmpeg/ffprobe not found. On macOS: brew install ffmpeg")
    sys.exit(1)

  src_dir = Path(args.source).expanduser().resolve()
  out_dir = Path(args.samples_dir).resolve()
  ir_dir = Path(args.impulses_dir).resolve()

  ensure_dir(out_dir)
  ensure_dir(ir_dir)

  # 1) Impulses — normalize or synthesize
  print("[step] Validating/repairing impulse responses…")
  ir_manifest = normalize_impulses(ir_dir)
  for name, path in ir_manifest.items():
    print(f"  [IR] {name}: {'OK -> ' + path if path else 'FAILED'}")

  # 2) Samples — scan sources (if any)
  print(f"[step] Scanning source samples in: {src_dir}")
  files = scan_source_files(src_dir) if src_dir.exists() else []
  available = [(p,m) for (p,m) in files if m is not None]
  by_midi = {}
  for p, m in available:
    by_midi.setdefault(m, []).append(p)

  if not available:
    print("[warn] No pitched source files recognized in your --source directory.")
    if args.generate_placeholders == "no":
      print("       Re-run with --generate-placeholders yes OR point --source at a valid sample set.")
      sys.exit(2)
    else:
      print("       Proceeding with placeholder generation so the app is immediately playable.")

  # 3) Render roots
  required_roots = [int(x) for x in args.roots.split(",") if x.strip()]
  produced = {}
  print(f"[step] Producing {len(required_roots)} root samples into {out_dir} as {args.format.upper()}")

  for midi in required_roots:
    # choose exact or nearest source if available
    chosen_src_midi = None
    if midi in by_midi:
      chosen_src_midi = midi
    elif by_midi:
      chosen_src_midi = nearest_available(midi, by_midi.keys())

    dst = out_dir / f"{midi}.{args.format.lower()}"
    if chosen_src_midi is not None:
      src = by_midi[chosen_src_midi][0]
      ok, msg = ensure_placeholder_or_convert({midi:src}, dst, midi, args.format, args.length)
    else:
      ok, msg = ensure_placeholder_or_convert({}, dst, midi, args.format, args.length)
    produced[midi] = {"path": str(dst), "status": "ok" if ok else "fail", "detail": msg}
    print(f"  [{ 'ok' if ok else '!!' }] {dst.name} — {msg}")

  # 4) Manifest
  manifest = {
    "generated_roots": sorted([int(k) for k,v in produced.items() if v["status"]=='ok']),
    "failed_roots": [int(k) for k,v in produced.items() if v["status"]!='ok'],
    "output_format": args.format.lower(),
    "samples_dir": str(out_dir),
    "impulses_dir": str(ir_dir),
    "impulses_fixed": ir_manifest
  }
  manifest_path = Path("assets-manifest.json")
  with open(manifest_path, "w") as f:
    json.dump(manifest, f, indent=2)
  print(f"\n[done] Manifest written: {manifest_path.resolve()}")
  if manifest["failed_roots"]:
    print("[note] Some roots failed. You can re-run just those by setting --roots to a subset.")
  print("[tip] Start your server and test:  python3 -m http.server 8000  -> http://localhost:8000")

if __name__ == "__main__":
  main()
