// The data contract for the entire pipeline.
// Claude outputs this JSON, every other module consumes it.

export interface VideoPackage {
  story_id: string;
  meta: {
    title_options: string[];
    thumbnail_prompt: string;
    description: string;
    tags: string[];
    hashtags: string[];
    chapters: { time: string; label: string }[];
    pinned_comment: string;
    captions: {
      youtube_shorts: string;
      tiktok: string;
      instagram: string;
      twitter: string;
    };
  };
  narration: {
    full_text: string;
    voice_id: string;
    estimated_duration_sec: number;
  };
  segments: Segment[];
}

export interface Segment {
  index: number;
  narration_text: string;
  duration_sec: 6;
  video_prompt: string;       // canonical going forward
  grok_prompt?: string;        // legacy alias for older package JSONs
  visual_style: "wide" | "close" | "medium" | "macro" | "aerial";
  motion: "static" | "slow_pan" | "zoom_in" | "zoom_out" | "tracking";
  overlay?: {
    type: "name" | "date" | "place" | "stat";
    text: string;
    appears_at_sec: number;
  };
  transition_in: "cut" | "fade" | "match_cut";
}