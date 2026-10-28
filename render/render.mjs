// Renders the storyboard to a video file, one frame at a time.
//
// The page runs in index.html?render mode in headless Chrome with a faked,
// paused clock: for every frame the clock is stepped forward exactly one
// frame, the page brings every layer to that instant, and a screenshot is
// piped into ffmpeg, which muxes the frames with the original audio track.
// Nothing runs in real time, so no frame is ever dropped or late.
//
//   node render.mjs                         whole video, 1080p30
//   node render.mjs --from 0 --duration 20  just the first 20 seconds
//   node render.mjs --scale 2               4K (same layout, twice the pixels)
//   node render.mjs --master                also write a ProRes 422 HQ .mov
//   node render.mjs --fit width             full width, thin black bars
//                                           (default: full height, sides cropped)
//
// Output goes to render/out/.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUDIO = join(ROOT, "audio/milan-me-bel-bele.mp3");
const PORT = 8790;

const { values: opts } = parseArgs({
  options: {
    from: { type: "string", default: "0" },
    duration: { type: "string" }, // default: to the end of the storyboard
    fps: { type: "string", default: "30" },
    // CSS size of the frame; --scale multiplies the output pixels only
    width: { type: "string", default: "1920" },
    height: { type: "string", default: "1080" },
    scale: { type: "string", default: "1" },
    out: { type: "string" },
    master: { type: "boolean", default: false },
    fit: { type: "string", default: "height" },
  },
});
const from = +opts.from;
const fps = +opts.fps;
const scale = +opts.scale;
const outW = Math.round(+opts.width * scale);
const outH = Math.round(+opts.height * scale);

function startServer() {
  const server = spawn("python3", ["serve.py", String(PORT)], { cwd: ROOT, stdio: "ignore" });
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    const poll = () =>
      fetch(`http://localhost:${PORT}/index.html`)
        .then(() => resolve(server))
        .catch(() => {
          if (Date.now() > deadline) reject(new Error("serve.py didn't start"));
          else setTimeout(poll, 200);
        });
    poll();
  });
}

function startEncoder(duration, outBase) {
  // frames come in as PNGs on stdin; the audio is cut to the same span and
  // padded with silence past the song's end (3:10.7 -- the storyboard runs
  // to 3:20)
  const args = [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-",
    "-ss", String(from), "-t", String(duration), "-i", AUDIO,
    "-map", "0:v", "-map", "1:a", "-af", "apad", "-t", String(duration),
  ];
  const yuv = (pixFmt) => [
    "-vf", `scale=out_color_matrix=bt709:out_range=tv,format=${pixFmt}`,
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-color_range", "tv",
  ];
  args.push(
    ...yuv("yuv420p"),
    "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-tune", "animation",
    "-movflags", "+faststart",
    "-c:a", "aac", "-b:a", "320k",
    `${outBase}.mp4`
  );
  if (opts.master) {
    args.push(
      "-map", "0:v", "-map", "1:a", "-af", "apad", "-t", String(duration),
      ...yuv("yuv422p10le"),
      "-c:v", "prores_ks", "-profile:v", "3",
      "-c:a", "pcm_s16le",
      `${outBase}.mov`
    );
  }
  const ffmpeg = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((resolve, reject) =>
    ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))))
  );
  return { stdin: ffmpeg.stdin, done };
}

function write(stream, chunk) {
  return stream.write(chunk) ? Promise.resolve() : new Promise((r) => stream.once("drain", r));
}

function fmt(sec) {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

const server = await startServer();
// installed Chrome rather than Playwright's own Chromium, which can't decode
// the H.264 piazza video
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({
    viewport: { width: +opts.width, height: +opts.height },
    deviceScaleFactor: scale,
  });
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.clock.install({ time: 0 });
  await page.goto(`http://localhost:${PORT}/index.html?render&from=${from}&fit=${opts.fit}`);
  await page.waitForFunction(() => window.renderReady, null, { polling: 100 });
  await page.evaluate(() => window.renderReady);

  const end = await page.evaluate(() => window.renderEnd);
  const duration = opts.duration !== undefined ? +opts.duration : end - from;
  const frames = Math.round(duration * fps);

  const pageNow = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(pageNow + 1000);
  await page.evaluate(() => window.renderStart());

  mkdirSync(join(ROOT, "render/out"), { recursive: true });
  const outBase =
    opts.out ?? join(ROOT, "render/out", `duomo_${outH}p${fps}_${opts.fit}_${from}s-${from + duration}s`);
  const encoder = startEncoder(duration, outBase);

  console.log(`rendering ${frames} frames (${fmt(from)}-${fmt(from + duration)}) at ${outW}x${outH}`);
  const started = Date.now();
  let elapsedMs = 0;
  for (let i = 0; i < frames; i++) {
    // whole milliseconds of faked time, rounded from the exact frame time
    // so the error never builds up over thousands of frames
    if (i > 0) {
      const target = Math.round((i * 1000) / fps);
      await page.clock.runFor(target - elapsedMs);
      elapsedMs = target;
    }
    await page.evaluate(() => window.renderFrame());
    await write(encoder.stdin, await page.screenshot({ type: "png" }));
    if (i % fps === 0 || i === frames - 1) {
      const perFrame = (Date.now() - started) / (i + 1);
      const eta = ((frames - i - 1) * perFrame) / 1000;
      process.stdout.write(`\r  ${fmt(from + i / fps)}  frame ${i + 1}/${frames}  ~${fmt(eta)} left   `);
    }
  }
  encoder.stdin.end();
  await encoder.done;
  console.log(`\ndone in ${fmt((Date.now() - started) / 1000)}: ${outBase}.mp4${opts.master ? " + .mov" : ""}`);
} finally {
  await browser.close();
  server.kill();
}
