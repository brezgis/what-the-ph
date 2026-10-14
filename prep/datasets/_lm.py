"""Hidden states for a word in a carrier sentence, from a small local LM."""

import numpy as np
import torch
from transformers import AutoModel, AutoTokenizer

MODEL = 'Qwen/Qwen2.5-0.5B'
_cache = {}


def _model():
    if 'm' not in _cache:
        tok = AutoTokenizer.from_pretrained(MODEL)
        m = AutoModel.from_pretrained(MODEL, torch_dtype=torch.float32).eval()
        _cache['m'] = (tok, m.to('cuda' if torch.cuda.is_available() else 'cpu'))
    return _cache['m']


@torch.no_grad()
def states(texts, target):
    """For each text, mean hidden state over the tokens of `target(i)` at every layer.

    Returns an array (layers+1, n, hidden), mean-centered per layer: transformer
    states share a big common offset that otherwise makes every cosine look alike."""
    tok, m = _model()
    out = []
    for i, text in enumerate(texts):
        word = target(i)
        start = text.index(word)
        enc = tok(text, return_offsets_mapping=True, return_tensors='pt')
        offs = enc.pop('offset_mapping')[0].tolist()
        idx = [j for j, (a, b) in enumerate(offs) if a < start + len(word) and b > start]
        hs = m(**enc.to(m.device), output_hidden_states=True).hidden_states
        out.append(torch.stack([h[0, idx].mean(0) for h in hs]).float().cpu().numpy())
    H = np.stack(out, axis=1)
    return H - H.mean(axis=1, keepdims=True)
