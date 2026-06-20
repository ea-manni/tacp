import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  useVideoConfig,
  useCurrentFrame,
  interpolate,
  spring,
} from "remotion";
import type { Segment } from "../types";
import { StillShot } from "./StillShot";

const FPS = 30;
const AUDIO_SPEEDUP = 1.15;

// Subtitle
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

// Overlay card
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

// Subscribe sticker
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

  const opacity = interpolate(frame, [endFrame - 15, endFrame], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

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
        SUBSCRIBE
      </div>
    </div>
  );
};

// One story segment = one still image with motion
const SegmentStill: React.FC<{
  segment: Segment;
  storyId: string;
  segmentImages: Record<number, string>;
}> = ({ segment, storyId, segmentImages }) => {
    const motion =
    segment.motion === "zoom_in"
      ? "push_in"
      : segment.motion === "zoom_out"
      ? "pull_out"
      : segment.motion === "slow_pan"
      ? "pan_left"
      : "drift";

  return (
    <StillShot
      imageSrc={segmentImages[segment.index] ?? ""}
      motion={motion}
    />
  );
};

export interface ToledotVideoProps {
  segments: Segment[];
  narration: { full_text: string };
  storyId: string;
  segmentFrames: number[];
  segmentImages: Record<number, string>;
  audioSrc: string;
  watermarkSrc?: string | null;
}

const Watermark: React.FC<{ src: string }> = ({ src }) => (
  <div style={{ position: "absolute", bottom: 40, right: 40, opacity: 0.85, zIndex: 1000 }}>
    <img src={src} style={{ height: 80, width: "auto" }} alt="" />
  </div>
);

export const ToledotVideo: React.FC<ToledotVideoProps> = ({
  segments,
  storyId,
  segmentFrames,
  segmentImages,
  audioSrc,
  watermarkSrc,
}) => {
  const { fps } = useVideoConfig();

  if (!segments || segments.length === 0 || !storyId) {
    return <AbsoluteFill style={{ backgroundColor: "black" }} />;
  }

  const safeSegmentFrames = segments.map((_, index) => {
    const frames = segmentFrames?.[index];
    if (!frames || frames <= 0) return FPS * 5;
    return Math.round(frames);
  });

  const segmentStarts: number[] = [];
  let cursor = 0;
  for (const frames of safeSegmentFrames) {
    segmentStarts.push(cursor);
    cursor += frames;
  }

  const subtitleChunks: {
    text: string;
    startFrame: number;
    endFrame: number;
  }[] = [];

  segments.forEach((seg, index) => {
    const narrationText = seg.narration_text?.trim();
    if (!narrationText) return;

    const words = narrationText.split(" ");
    const wordsPerChunk = 5;
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += wordsPerChunk) {
      chunks.push(words.slice(i, i + wordsPerChunk).join(" "));
    }

    const segStart = segmentStarts[index];
    const segLength = safeSegmentFrames[index];
    const framesPerChunk = segLength / chunks.length;

    chunks.forEach((chunk, chunkIndex) => {
      subtitleChunks.push({
        text: chunk,
        startFrame: segStart + Math.round(chunkIndex * framesPerChunk),
        endFrame: segStart + Math.round((chunkIndex + 1) * framesPerChunk),
      });
    });
  });

  const subscribeStickerFrame = Math.round(fps * 10);

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Audio src={audioSrc} playbackRate={AUDIO_SPEEDUP} />

      {segments.map((seg, index) => (
        <Sequence
          key={seg.index}
          from={segmentStarts[index]}
          durationInFrames={safeSegmentFrames[index]}
        >
          <SegmentStill segment={seg} segmentImages={segmentImages} />
        </Sequence>
      ))}

      {subtitleChunks.map((chunk, index) => (
        <Subtitle
          key={index}
          text={chunk.text}
          startFrame={chunk.startFrame}
          endFrame={chunk.endFrame}
        />
      ))}

      {segments
        .filter((seg) => seg.overlay)
        .map((seg) => {
          const segmentIndex = segments.indexOf(seg);
          const overlay = seg.overlay!;
          return (
            <OverlayCard
              key={seg.index}
              text={overlay.text}
              type={overlay.type}
              startFrame={
                segmentStarts[segmentIndex] +
                Math.round(overlay.appears_at_sec * FPS)
              }
            />
          );
        })}

      <SubscribeSticker startFrame={subscribeStickerFrame} />

      {watermarkSrc && <Watermark src={watermarkSrc} />}
    </AbsoluteFill>
  );
};
