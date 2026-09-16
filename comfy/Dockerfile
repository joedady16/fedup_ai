# ComfyUI for an 8GB card that also hosts Ollama.
#
# PyTorch 2.9.1 / CUDA 12.8. Current ComfyUI needs torch >= 2.6: its
# comfy_kitchen dependency registers custom ops with list[int] parameters,
# which torch.library.infer_schema only learned to accept in later releases.
FROM pytorch/pytorch:2.9.1-cuda12.8-cudnn9-runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
      git libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

# Pinned so a rebuild months from now produces the same working stack.
ARG COMFY_VERSION=v0.36.0

WORKDIR /opt
RUN git clone --depth 1 --branch ${COMFY_VERSION} \
      https://github.com/comfyanonymous/ComfyUI.git
WORKDIR /opt/ComfyUI
RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 8188
# --lowvram keeps the image model from evicting Ollama's chat model outright;
# the app also hands VRAM over explicitly around each render.
CMD ["python", "main.py", "--listen", "0.0.0.0", "--port", "8188", "--lowvram"]
