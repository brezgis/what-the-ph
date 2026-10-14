"""DINOv2 embeddings and ink-mask thumbnails for the image datasets."""

import base64
import io

import numpy as np
import torch
from PIL import Image
from transformers import AutoImageProcessor, AutoModel

MODEL = 'facebook/dinov2-small'
_cache = {}


@torch.no_grad()
def dino(images):
    """CLS embedding (384-d) for each PIL image."""
    if 'm' not in _cache:
        dev = 'cuda' if torch.cuda.is_available() else 'cpu'
        _cache['m'] = (AutoImageProcessor.from_pretrained(MODEL),
                       AutoModel.from_pretrained(MODEL).eval().to(dev), dev)
    proc, m, dev = _cache['m']
    out = []
    for k in range(0, len(images), 64):
        batch = proc(images=[im.convert('RGB') for im in images[k:k + 64]], return_tensors='pt').to(dev)
        out.append(m(**batch).last_hidden_state[:, 0].float().cpu().numpy())
    return np.concatenate(out)


def thumb(im, size, dark_is_ink=False):
    """Grayscale PNG data URI where brightness = how much ink. The page tints it.

    `size` is the longer side; the aspect ratio is kept. Photos and paintings want
    dark_is_ink, so they print like a cyanotype."""
    from PIL import ImageOps
    g = im.convert('L')
    if dark_is_ink:
        g = ImageOps.autocontrast(ImageOps.invert(g), cutoff=1)
    w, h = g.size
    k = size / max(w, h)
    buf = io.BytesIO()
    g.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS).save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def thumb_orig(im, size):
    """The image as it really looks (color kept), longer side = size, PNG data URI."""
    w, h = im.size
    k = size / max(w, h)
    buf = io.BytesIO()
    im.convert('RGB' if im.mode not in ('L', 'LA') else 'L').resize(
        (max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS).save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def pixels(images, size):
    return np.stack([np.asarray(im.convert('L').resize((size, size), Image.LANCZOS), np.float32) / 255
                     for im in images]).reshape(len(images), -1)
