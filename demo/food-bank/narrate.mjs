// Adds a narration track to each walkthrough video with ElevenLabs text-to-speech.
// Usage: ELEVENLABS_API_KEY=... node demo/food-bank/narrate.mjs <videos-dir>
// Reads demo/food-bank/narration.json, writes <name>-narrated.mp4 next to each <name>.mp4.
// If the narration runs longer than the video, the last frame is held so nothing is cut off.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("Set ELEVENLABS_API_KEY");
const VOICE_ID = "XrExE9yKIg1WjnnlVkGX"; // Matilda
const MODEL_ID = "eleven_multilingual_v2";
const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(process.argv[2] || ".");
const scripts = JSON.parse(await readFile(join(here, "narration.json"), "utf8"));

function duration(file) {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
}

for (const [name, text] of Object.entries(scripts)) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODEL_ID }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${name} failed: ${res.status} ${await res.text()}`);
  const audio = join(dir, `${name}.narration.mp3`);
  await writeFile(audio, Buffer.from(await res.arrayBuffer()));

  const video = join(dir, `${name}.mp4`);
  const hold = Math.max(0, duration(audio) - duration(video));
  const out = join(dir, `${name}-narrated.mp4`);
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-i", video, "-i", audio,
    "-filter_complex", `[0:v]tpad=stop_mode=clone:stop_duration=${hold.toFixed(2)}[v]`,
    "-map", "[v]", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", out,
  ]);
  console.log("wrote", out, `narration ${duration(audio).toFixed(1)}s, video ${duration(video).toFixed(1)}s`);
}
