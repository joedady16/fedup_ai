import "server-only";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const COMFY = process.env.COMFYUI_URL ?? "http://comfyui:8188";
const CKPT = process.env.COMFYUI_MODEL ?? "sd_xl_turbo_1.0_fp16.safetensors";
export const IMAGES_DIR = process.env.IMAGES_DIR ?? "/app/generated";

export const imagesEnabled = () => (process.env.IMAGE_PROVIDER ?? "comfy") !== "none";

/**
 * Minimal SDXL-Turbo graph. Turbo is distilled for 1-4 steps at cfg 1.0,
 * which is what makes it viable on an 8GB card shared with Ollama.
 */
function workflow(prompt: string, negative: string, seed: number) {
  return {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CKPT } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: negative, clip: ["4", 1] } },
    "3": {
      class_type: "KSampler",
      inputs: {
        seed, steps: 4, cfg: 1.0, sampler_name: "euler", scheduler: "normal", denoise: 1.0,
        model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0],
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "fedup", images: ["8", 0] } },
  };
}

type HistoryOutputs = Record<
  string,
  { images?: { filename: string; subfolder: string; type: string }[] }
>;

/**
 * Queues a render and waits for it. Returns a public URL under /generated.
 * Throws with a readable message if ComfyUI is down or the model is missing.
 */
export async function generateImage(prompt: string, negative = ""): Promise<string> {
  const clientId = randomUUID();
  const seed = Math.floor(Math.random() * 2 ** 31);

  const queued = await fetch(`${COMFY}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, prompt: workflow(prompt, negative, seed) }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new Error("Image service is not reachable. Start it: docker compose --profile images up -d");
  });

  if (!queued.ok) {
    throw new Error(
      `Image service rejected the request (${queued.status}). ` +
        `Check that "${CKPT}" exists in comfy/models/checkpoints/.`,
    );
  }
  const { prompt_id } = (await queued.json()) as { prompt_id: string };

  // Poll history until the render lands (turbo renders are quick, but the
  // model has to page into VRAM on the first call).
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    const h = await fetch(`${COMFY}/history/${prompt_id}`).catch(() => null);
    if (!h?.ok) continue;

    const hist = (await h.json()) as Record<string, { outputs?: HistoryOutputs }>;
    const outputs = hist[prompt_id]?.outputs;
    if (!outputs) continue;

    for (const node of Object.values(outputs)) {
      const img = node.images?.[0];
      if (!img) continue;

      const q = new URLSearchParams({
        filename: img.filename,
        subfolder: img.subfolder ?? "",
        type: img.type ?? "output",
      });
      const bin = await fetch(`${COMFY}/view?${q}`);
      if (!bin.ok) throw new Error("Rendered image could not be downloaded.");

      const name = `${randomUUID()}.png`;
      await mkdir(IMAGES_DIR, { recursive: true });
      await writeFile(path.join(IMAGES_DIR, name), Buffer.from(await bin.arrayBuffer()));
      return `/generated/${name}`;
    }
  }
  throw new Error("Image generation timed out after 4 minutes.");
}
