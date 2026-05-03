// Gemini TTS voice roster for Toledot Stories narration.
// Claude picks from this list based on story tone and emotional register.

export interface VoiceProfile {
  voice_name: string;
  gender: "male" | "female";
  tone: string[];
  best_for: string[];
}

export const VOICE_ROSTER: VoiceProfile[] = [
  {
    voice_name: "Charon",
    gender: "male",
    tone: ["deep", "authoritative", "dark", "cinematic"],
    best_for: ["genocide", "war", "empire collapse", "atrocities", "military history"],
  },
  {
    voice_name: "Fenrir",
    gender: "male",
    tone: ["intense", "gritty", "tense", "commanding"],
    best_for: ["conspiracy", "uprising", "assassination", "resistance movements"],
  },
  {
    voice_name: "Orus",
    gender: "male",
    tone: ["warm", "engaging", "measured", "documentary"],
    best_for: ["forgotten history", "buried stories", "cultural history", "African empires"],
  },
  {
    voice_name: "Schedar",
    gender: "male",
    tone: ["authoritative", "bold", "epic", "strong"],
    best_for: ["fallen empires", "power and betrayal", "political history", "WWII"],
  },
  {
    voice_name: "Kore",
    gender: "female",
    tone: ["commanding", "authoritative", "clear", "regal"],
    best_for: ["queens and rulers", "matriarchal history", "African queens", "power"],
  },
  {
    voice_name: "Aoede",
    gender: "female",
    tone: ["warm", "expressive", "storytelling", "emotional"],
    best_for: ["personal stories", "survival", "human interest", "overlooked individuals"],
  },
  {
    voice_name: "Leda",
    gender: "female",
    tone: ["smooth", "intimate", "cinematic", "dramatic"],
    best_for: ["betrayal", "strange historical turns", "Brazilian history", "American history"],
  },
];

export const VOICE_SELECTOR_PROMPT = `You are a casting director for a cinematic history channel called Toledot Stories.

Given a story context, select the most appropriate voice from the roster below. Consider the story's tone, emotional register, subject matter, and which narrator voice would make this story land hardest.

VOICE ROSTER:
${JSON.stringify(VOICE_ROSTER, null, 2)}

Return ONLY a JSON object with these fields:
{
  "voice_name": "the chosen voice_name string",
  "tone_instruction": "a short natural language instruction for delivery style, e.g. 'Speak with slow, measured gravitas. Let the weight of each sentence land.'",
  "reasoning": "one sentence explaining the choice"
}

No other text. No markdown. No code fences.`;