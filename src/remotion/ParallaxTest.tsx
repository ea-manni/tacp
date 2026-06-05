import React from "react";
import { StillShot } from "./StillShot";

export const ParallaxTest: React.FC = () => {
  return (
    <StillShot
      imageSrc="parallax/test.jpg"
      motion="push_in"
      label="TACP v3 — Reusable StillShot Test"
    />
  );
};