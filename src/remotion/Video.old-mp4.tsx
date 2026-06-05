import React from "react";
import {
  AbsoluteFill,
  Audio,
  Video,
  Sequence,
  useVideoConfig,
  useCurrentFrame,
  interpolate,
  spring,
  staticFile,
} from "remotion";
import type { Segment } from "../types";

const FPS = 30;
const AUDIO_SPEEDUP = 1.15;
const RAW_CLIP_SECONDS = 6; // generated clips are 6s long

// ─── Subtitle ────────────────────────────────────────────────────────────────
const Subtitle: React.FC<{
  text: string;
  startFrame: number;
  endFrame: number;
}> = ({ text, startFrame, endFrame }) => {
  const frame = useCurrentFrame();
  if (frame < startFrame || frame > endFrame) return null;

  const opacity = interpolate(
    frame,
    [startFrame, startFrame + 3, endFrame - 3, endFrame],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        position: "absolute",
        bottom: 180,
        left: 60,
        right: 60,
        textAlign: "center",
        opacity,
      }}
    >
      <span
        style={{
          backgroundColor: "rgba(0,0,0,0.6)",
          color: "white",
          fontSize: 52,
          fontWeight: "bold",
          fontFamily: "Georgia, serif",
          lineHeight: 1.4,
          padding: "8px 16px",
          borderRadius: 8,
          display: "inline",
        }}
      >
        {text}
      </span>
    </div>
  );
};

// ─── Overlay Card ─────────────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  name: "#C9A84C",
  date: "#4C9AC9",
  place: "#4CC97A",
  stat: "#C94C4C",
};

const OverlayCard: React.FC<{
  text: string;
  type: "name" | "date" | "place" | "stat";
  startFrame: number;
}> = ({ text, type, startFrame }) => {
  const frame = useCurrentFrame();
  const endFrame = startFrame + 90;
  if (frame < startFrame || frame > endFrame) return null;

  const slideX = interpolate(
    frame,
    [startFrame, startFrame + 10],
    [-300, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const opacity = interpolate(
    frame,
    [startFrame, startFrame + 10, endFrame - 10, endFrame],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        position: "absolute",
        bottom: 320,
        left: 60,
        transform: `translateX(${slideX}px)`,
        opacity,
      }}
    >
      <div
        style={{
          backgroundColor: TYPE_COLORS[type] ?? "#C9A84C",
          color: "black",
          fontSize: 36,
          fontWeight: "bold",
          fontFamily: "Georgia, serif",
          padding: "10px 20px",
          borderRadius: 8,
          maxWidth: 500,
        }}
      >
        {text}
      </div>
    </div>
  );
};

// ─── Subscribe Sticker ────────────────────────────────────────────────────────
const SubscribeSticker: React.FC<{ startFrame: number }> = ({ startFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const endFrame = startFrame + 90;
  if (frame < startFrame || frame > endFrame) return null;

  const scale = spring({
    frame: frame - startFrame,
    fps,
    config: { damping: 12, stiffness: 200, mass: 0.8 },
  });

  const opacity = interpolate(
    frame,
    [endFrame - 15, endFrame],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        position: "absolute",
        top: 80,
        right: 60,
        transform: `scale(${scale})`,
        opacity,
        transformOrigin: "top right",
      }}
    >
      <div
        style={{
          backgroundColor: "#FF0000",
          color: "white",
          fontSize: 32,
          fontWeight: "bold",
          fontFamily: "Arial, sans-serif",
          padding: "14px 28px",
          borderRadius: 50,
          display: "flex",
          alignItems: "center",
          gap: 10,
          boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
        }}
      >
        🔔 SUBSCRIBE
      </div>
    </div>
  );
};

// ─── Segment Clip ─────────────────────────────────────────────────────────────
const SegmentClip: React.FC<{
  segment: Segment;
  storyId: string;
  segmentFrames: number;
}> = ({ segment, storyId, segmentFrames }) => {
  const frame = useCurrentFrame();
  // localFrame is relative to this Sequence's start (Remotion handles this when nested)
  const localFrame = frame;

  // Stretch the 6s raw clip to fill segmentFrames at this fps
  const targetSeconds = segmentFrames / FPS;
  const playbackRate = RAW_CLIP_SECONDS / targetSeconds; // <1 slows down, >1 speeds up

  const scale = (() => {
    if (segment.motion === "zoom_in")
      return interpolate(localFrame, [0, segmentFrames], [1, 1.08], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    if (segment.motion === "zoom_out")
      return interpolate(localFrame, [0, segmentFrames], [1.08, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    return 1;
  })();

  const translateX = (() => {
    if (segment.motion === "slow_pan")
      return interpolate(localFrame, [0, segmentFrames], [0, -40], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    return 0;
  })();

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Video
        src={staticFile(`clips/${storyId}/${segment.index}.mp4`)}
        playbackRate={playbackRate}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale}) translateX(${translateX}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, rgba(10,5,0,0.3) 0%, transparent 30%, transparent 70%, rgba(0,0,10,0.5) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

// ─── Main Composition ─────────────────────────────────────────────────────────
export interface ToledotVideoProps {
  segments: Segment[];
  narration: { full_text: string };
  storyId: string;
  segmentFrames: number[]; // per-segment frame allocations
}

export const ToledotVideo: React.FC<ToledotVideoProps> = ({
  segments,
  storyId,
  segmentFrames,
}) => {
  const { fps } = useVideoConfig();

  if (!segments || segments.length === 0) {
    return <AbsoluteFill style={{ backgroundColor: "black" }} />;
  }

  // Compute cumulative start frame for each segment
  const segmentStarts: number[] = [];
  let cursor = 0;
  for (const f of segmentFrames) {
    segmentStarts.push(cursor);
    cursor += f;
  }

  // Build subtitle chunks — distributed proportionally within each segment's allocated frames
  const subtitleChunks: {
    text: string;
    startFrame: number;
    endFrame: number;
  }[] = [];

  segments.forEach((seg, i) => {
    const words = seg.narration_text.trim().split(" ");
    const wordsPerChunk = 5;
    const chunks: string[] = [];
    for (let j = 0; j < words.length; j += wordsPerChunk) {
      chunks.push(words.slice(j, j + wordsPerChunk).join(" "));
    }
    const segStart = segmentStarts[i];
    const segLength = segmentFrames[i];
    const framesPerChunk = segLength / chunks.length;
    chunks.forEach((chunk, k) => {
      subtitleChunks.push({
        text: chunk,
        startFrame: segStart + Math.round(k * framesPerChunk),
        endFrame: segStart + Math.round((k + 1) * framesPerChunk),
      });
    });
  });

  const subscribeStickerFrame = Math.round(fps * 10);

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Audio src={staticFile(`audio/${storyId}.wav`)} playbackRate={AUDIO_SPEEDUP} />

      {segments.map((seg, i) => (
        <Sequence
          key={seg.index}
          from={segmentStarts[i]}
          durationInFrames={segmentFrames[i]}
        >
          <SegmentClip segment={seg} storyId={storyId} segmentFrames={segmentFrames[i]} />
        </Sequence>
      ))}

      {subtitleChunks.map((chunk, i) => (
        <Subtitle
          key={i}
          text={chunk.text}
          startFrame={chunk.startFrame}
          endFrame={chunk.endFrame}
        />
      ))}

      {segments
        .filter((seg) => seg.overlay)
        .map((seg, idx) => {
          const segIdx = segments.indexOf(seg);
          return (
            <OverlayCard
              key={seg.index}
              text={seg.overlay!.text}
              type={seg.overlay!.type}
              startFrame={
                segmentStarts[segIdx] +
                Math.round(seg.overlay!.appears_at_sec * FPS)
              }
            />
          );
        })}

      <SubscribeSticker startFrame={subscribeStickerFrame} />
    </AbsoluteFill>
  );
};