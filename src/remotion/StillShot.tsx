import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

type MotionType = "push_in" | "pull_out" | "pan_left" | "pan_right" | "drift";

export const StillShot: React.FC<{
  imageSrc: string;
  motion?: MotionType;
  label?: string;
}> = ({ imageSrc, motion = "push_in", label }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = frame / durationInFrames;

  const scale = (() => {
    if (motion === "push_in") return interpolate(progress, [0, 1], [1.06, 1.18]);
    if (motion === "pull_out") return interpolate(progress, [0, 1], [1.18, 1.06]);
    return interpolate(progress, [0, 1], [1.1, 1.14]);
  })();

  const translateX = (() => {
    if (motion === "pan_left") return interpolate(progress, [0, 1], [40, -40]);
    if (motion === "pan_right") return interpolate(progress, [0, 1], [-40, 40]);
    if (motion === "drift") return interpolate(progress, [0, 1], [-25, 25]);
    return 0;
  })();

  const translateY = motion === "drift" ? interpolate(progress, [0, 1], [20, -20]) : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      <AbsoluteFill
        style={{ transform: `scale(${scale}) translate(${translateX}px, ${translateY}px)` }}
      >
        <Img src={imageSrc} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.45), transparent 30%, transparent 65%, rgba(0,0,0,0.75))" }}
      />
      <AbsoluteFill style={{ background: "rgba(180, 120, 50, 0.08)", mixBlendMode: "soft-light" }} />
      <AbsoluteFill style={{ boxShadow: "inset 0 0 220px rgba(0,0,0,0.65)" }} />
      <AbsoluteFill
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.12) 1px, transparent 1px)",
          backgroundSize: "4px 4px",
          opacity: 0.07,
        }}
      />
      {label && (
        <div
          style={{
            position: "absolute", bottom: 150, left: 60, right: 60,
            color: "white", fontSize: 34, fontFamily: "Georgia, serif",
            opacity: 0.88, textShadow: "0 4px 18px rgba(0,0,0,0.8)",
          }}
        >
          {label}
        </div>
      )}
    </AbsoluteFill>
  );
};