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

const FRAMES_PER_CLIP = 180;
const FPS = 30;

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
const SegmentClip: React.FC<{ segment: Segment; storyId: string }> = ({
  segment,
  storyId,
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - segment.index * FRAMES_PER_CLIP;

  const scale = (() => {
    if (segment.motion === "zoom_in")
      return interpolate(localFrame, [0, FRAMES_PER_CLIP], [1, 1.08], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    if (segment.motion === "zoom_out")
      return interpolate(localFrame, [0, FRAMES_PER_CLIP], [1.08, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    return 1;
  })();

  const translateX = (() => {
    if (segment.motion === "slow_pan")
      return interpolate(localFrame, [0, FRAMES_PER_CLIP], [0, -40], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    return 0;
  })();

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Video
        src={staticFile(`clips/${storyId}/${segment.index}.mp4`)}
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
}

export const ToledotVideo: React.FC<ToledotVideoProps> = ({
  segments,
  narration,
  storyId,
}) => {
  const { fps } = useVideoConfig();

  if (!segments || segments.length === 0) {
    return <AbsoluteFill style={{ backgroundColor: "black" }} />;
  }

  // Build subtitle chunks — 5 words per chunk per segment
  const subtitleChunks: {
    text: string;
    startFrame: number;
    endFrame: number;
  }[] = [];

  segments.forEach((seg) => {
    const words = seg.narration_text.trim().split(" ");
    const wordsPerChunk = 5;
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += wordsPerChunk) {
      chunks.push(words.slice(i, i + wordsPerChunk).join(" "));
    }
    const segStartFrame = seg.index * FRAMES_PER_CLIP;
    const framesPerChunk = FRAMES_PER_CLIP / chunks.length;
    chunks.forEach((chunk, i) => {
      subtitleChunks.push({
        text: chunk,
        startFrame: segStartFrame + Math.round(i * framesPerChunk),
        endFrame: segStartFrame + Math.round((i + 1) * framesPerChunk),
      });
    });
  });

  const subscribeStickerFrame = Math.round(fps * 10);

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Audio src={staticFile(`audio/${storyId}.wav`)} />

      {segments.map((seg) => (
        <Sequence
          key={seg.index}
          from={seg.index * FRAMES_PER_CLIP}
          durationInFrames={FRAMES_PER_CLIP}
        >
          <SegmentClip segment={seg} storyId={storyId} />
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
        .map((seg) => (
          <OverlayCard
            key={seg.index}
            text={seg.overlay!.text}
            type={seg.overlay!.type}
            startFrame={
              seg.index * FRAMES_PER_CLIP +
              Math.round(seg.overlay!.appears_at_sec * FPS)
            }
          />
        ))}

      <SubscribeSticker startFrame={subscribeStickerFrame} />
    </AbsoluteFill>
  );
};