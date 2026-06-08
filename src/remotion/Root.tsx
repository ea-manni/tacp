import React from "react";
import { Composition } from "remotion";
import { ToledotVideo } from "./Video";
import { ParallaxTest } from "./ParallaxTest";

const VideoComp = ToledotVideo as unknown as React.ComponentType<Record<string, unknown>>;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ToledotVideo"
        component={VideoComp}
        durationInFrames={300}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          segments: [],
          narration: { full_text: "" },
          storyId: "",
          segmentFrames: [],
          segmentImages: {},
        }}
      />

      <Composition
        id="ToledotStillsTest"
        component={VideoComp}
        durationInFrames={250}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          storyId: "test-story",
          narration: {
            full_text: "In the beginning there was darkness. Then came the fire. And everything changed.",
          },
          segments: [
            { index: 1, narration_text: "In the beginning there was darkness.", motion: "push_in" },
            { index: 2, narration_text: "Then came the fire.", motion: "pull_out" },
            { index: 3, narration_text: "And everything changed.", motion: "pan_left" },
          ],
          segmentFrames: [90, 75, 85],
          segmentImages: {},
        }}
      />

      <Composition
        id="ParallaxTest"
        component={ParallaxTest}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};