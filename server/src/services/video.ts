import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPathDefault from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { FORMAT_SPECS, type PostFormat } from "@socmedia/shared";

const execFileAsync = promisify(execFile);

/** ffprobe/ffmpeg are given up to 5 minutes to finish (large files / slow machines). */
const TIMEOUT_MS = 5 * 60 * 1000;
const MAX_BUFFER = 20 * 1024 * 1024;

function ffmpegBin(): string {
  if (!ffmpegPathDefault) throw new Error("ffmpeg-static binary not found for this platform");
  return ffmpegPathDefault;
}

export interface VideoProbe {
  durationSeconds: number;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
}

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string };
}

/** Probes a video file with ffprobe for duration, dimensions and whether it carries an audio stream. */
export async function probeVideo(inputPath: string): Promise<VideoProbe> {
  const { stdout } = await execFileAsync(
    ffprobeStatic.path,
    ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", inputPath],
    { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER }
  );
  const data = JSON.parse(stdout) as FfprobeOutput;
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const videoStream = streams.find((s) => s.codec_type === "video");
  const hasAudio = streams.some((s) => s.codec_type === "audio");
  const durationRaw = data.format?.duration ?? videoStream?.duration;
  const durationSeconds = durationRaw ? Math.round(Number(durationRaw) * 100) / 100 : 0;
  return {
    durationSeconds,
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    hasAudio,
  };
}

/** Extracts a JPEG poster frame (480px wide) at 1s into the video, or 0s when it's shorter than that. */
export async function posterFrame(inputPath: string, outputPath: string): Promise<void> {
  let seekAt = 0;
  try {
    const probe = await probeVideo(inputPath);
    seekAt = probe.durationSeconds > 1 ? 1 : 0;
  } catch {
    seekAt = 0;
  }
  await execFileAsync(
    ffmpegBin(),
    ["-y", "-ss", String(seekAt), "-i", inputPath, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "3", outputPath],
    { timeout: TIMEOUT_MS }
  );
}

export interface TrimOptions {
  input: string;
  output: string;
  start: number;
  end: number;
  format?: PostFormat | null;
  muted?: boolean;
}

/** Trims [start, end] from `input` into `output` (H.264/AAC, faststart), optionally scaling/cropping to a format. */
export async function trimVideo(opts: TrimOptions): Promise<VideoProbe> {
  const args = ["-y", "-ss", String(opts.start), "-to", String(opts.end), "-i", opts.input];

  if (opts.format) {
    const spec = FORMAT_SPECS[opts.format];
    args.push("-vf", `scale=${spec.width}:${spec.height}:force_original_aspect_ratio=increase,crop=${spec.width}:${spec.height}`);
  }

  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23");
  if (opts.muted) {
    args.push("-an");
  } else {
    args.push("-c:a", "aac");
  }
  args.push("-movflags", "+faststart", opts.output);

  await execFileAsync(ffmpegBin(), args, { timeout: TIMEOUT_MS });
  return probeVideo(opts.output);
}
