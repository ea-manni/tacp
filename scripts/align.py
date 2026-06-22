import whisperx
import json
import sys
import argparse

# Parse positional args + optional device/compute-type flags
# Usage (GPU):  python3 align.py audio.wav segments.json
# Usage (CPU):  python3 align.py audio.wav segments.json --device cpu --compute-type int8
parser = argparse.ArgumentParser()
parser.add_argument("audio_path")
parser.add_argument("segments_path")
parser.add_argument("--device", default="cuda")
parser.add_argument("--compute-type", default="float16", dest="compute_type")
args = parser.parse_args()

audio_path = args.audio_path
segments_path = args.segments_path
device = args.device
compute_type = args.compute_type

with open(segments_path) as f:
    segments = json.load(f)

model = whisperx.load_model("base", device, compute_type=compute_type)
audio = whisperx.load_audio(audio_path)
result = model.transcribe(audio)

align_model, metadata = whisperx.load_align_model(language_code=result["language"], device=device)
result = whisperx.align(result["segments"], align_model, metadata, audio, device)

words = []
for seg in result["segments"]:
    for w in seg.get("words", []):
        words.append({
            "word": w["word"].strip().lower(),
            "start": w.get("start", 0),
            "end": w.get("end", 0),
        })

segment_durations = []
word_idx = 0
prev_end = 0.0

for seg in segments:
    seg_words = seg["narration_text"].lower().split()
    seg_word_count = len(seg_words)
    end_idx = min(word_idx + seg_word_count - 1, len(words) - 1)
    if 0 <= end_idx < len(words) and words[end_idx]["end"] > 0:
        seg_end = words[end_idx]["end"]
    else:
        seg_end = prev_end + 5.0
    seg_end = max(seg_end, prev_end + 1.0)  # guarantee strictly monotonic
    duration = seg_end - prev_end
    segment_durations.append(max(duration, 1.0))
    prev_end = seg_end
    word_idx += seg_word_count

total = sum(segment_durations)
print(json.dumps({"segment_durations": segment_durations, "total_duration": total}))