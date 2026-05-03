import React from "react";
import { Composition } from "remotion";
import { ToledotVideo } from "./Video";
import type { VideoPackage } from "../types";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ToledotVideo"
      component={ToledotVideo as unknown as React.ComponentType<Record<string, unknown>>}
      durationInFrames={300}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{}}
    />
  );
};