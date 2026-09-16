# ComfyUI on CUDA 12.4 — tuned for an 8GB card that is also hosting Ollama.
FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
      git libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git
WORKDIR /opt/ComfyUI
RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 8188
# --lowvram keeps the image model from evicting Ollama's chat model.
CMD ["python", "main.py", "--listen", "0.0.0.0", "--port", "8188", "--lowvram"]
