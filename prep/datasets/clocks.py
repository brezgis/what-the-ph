"""Clocks: 144 times of day as a drawn clock face vs as text read by an LM.

Also home of `lm_states`, a small hidden-state helper (any causal LM, any span)
shared with numbers.py.
"""

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFilter
from transformers import AutoModel, AutoTokenizer

from ._vision import thumb

MODEL = 'meta-llama/Llama-3.2-1B'
LAYER = 8
SIZE = 48
BLUR = 5      # px: hands a few degrees apart should look alike, not merely 'different'
CARRIERS = [
    'The meeting starts at {T}.',
    'We left the house at {T} sharp.',
    'My alarm went off at {T} this morning.',
    'The train arrives at {T}, so don’t be late.',
    'It was already {T} when she called.',
    'Let’s meet at {T} by the fountain.',
]
WORDS = 'twelve one two three four five six seven eight nine ten eleven twelve'.split()

_cache = {}


def _model(name):
    if _cache.get('name') != name:
        _cache.clear()                              # one model in memory at a time
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        tok = AutoTokenizer.from_pretrained(name)
        m = AutoModel.from_pretrained(name, torch_dtype=torch.float32).eval()
        _cache.update(name=name, tok=tok, m=m.to('cuda' if torch.cuda.is_available() else 'cpu'))
    return _cache['tok'], _cache['m']


@torch.no_grad()
def lm_states(name, texts, spans, pick='mean'):
    """Hidden states of model `name` at every layer for the tokens covering the
    character span spans[i] of texts[i]: their mean (pick='mean') or the last one
    (pick='last'). Returns (layers+1, n, hidden), mean-centred per layer."""
    tok, m = _model(name)
    out = []
    for text, (a, b) in zip(texts, spans):
        enc = tok(text, return_offsets_mapping=True, return_tensors='pt')
        offs = enc.pop('offset_mapping')[0].tolist()
        idx = [j for j, (s, e) in enumerate(offs) if s < b and e > a and e > s]
        if pick == 'last':
            idx = idx[-1:]
        hs = m(**enc.to(m.device), output_hidden_states=True).hidden_states
        out.append(torch.stack([h[0, idx].mean(0) for h in hs]).float().cpu().numpy())
    H = np.stack(out, axis=1)
    return H - H.mean(axis=1, keepdims=True)


def carrier_states(name, items, carriers, pick='mean'):
    """lm_states for each item string, averaged over the carrier sentences."""
    Hs = []
    for c in carriers:
        texts = [c.replace('{T}', s) for s in items]
        k = c.index('{T}')
        Hs.append(lm_states(name, texts, [(k, k + len(s)) for s in items], pick))
    return np.mean(Hs, axis=0)


def times():
    return [(h, m) for h in [12, *range(1, 12)] for m in range(0, 60, 5)]


def words(h, m):
    nxt = WORDS[h % 12 + 1]
    here = WORDS[h % 12] if h != 12 else 'twelve'
    mins = {5: 'five', 10: 'ten', 15: 'quarter', 20: 'twenty', 25: 'twenty-five'}
    if m == 0:
        return f'{here} o’clock'
    if m == 30:
        return f'half past {here}'
    if m < 30:
        return f'{mins[m]} past {here}'
    return f'{mins[60 - m]} to {nxt}'


def face(h, m, size=SIZE, ss=4):
    """White-on-black clock face (bright = ink), drawn big and shrunk for smooth lines."""
    S = size * ss
    im = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(im)
    c, R = S / 2, S / 2 - 2 * ss
    d.ellipse([c - R, c - R, c + R, c + R], outline=255, width=int(1.5 * ss))
    for k in range(12):
        t = np.radians(k * 30)
        r0 = R * (0.78 if k % 3 == 0 else 0.86)
        d.line([c + r0 * np.sin(t), c - r0 * np.cos(t), c + R * 0.95 * np.sin(t), c - R * 0.95 * np.cos(t)],
               fill=255, width=int(1.2 * ss))
    for ang, length, w in [((h % 12 + m / 60) * 30, 0.5, 3.2), (m * 6, 0.8, 1.8)]:
        t = np.radians(ang)
        d.line([c, c, c + R * length * np.sin(t), c - R * length * np.cos(t)], fill=255, width=int(w * ss))
    r = 1.6 * ss
    d.ellipse([c - r, c - r, c + r, c + r], fill=255)
    return im.resize((size, size), Image.LANCZOS)


def load(model=MODEL, layer=LAYER, pick='mean'):
    T = times()
    labels = [f'{h}:{m:02d}' for h, m in T]
    ims = [face(h, m) for h, m in T]
    # the pixel view is blurred; without it any two non-overlapping hands are equally
    # far apart and the hands' torus falls into a heap of tiny loops
    P = np.stack([np.asarray(im.filter(ImageFilter.GaussianBlur(BLUR)), np.float32) / 255
                  for im in ims]).reshape(len(ims), -1)
    H = carrier_states(model, labels, CARRIERS, pick)
    short = model.split('/')[1]
    return {
        'title': 'Telling the time',
        'blurb': f'Every five minutes round the clock, 144 times. One view is a drawn '
                 f'clock face ({SIZE}×{SIZE} pixels, softly blurred): the hands go round, so '
                 f'11:55 sits right next to 12:00. The other is {short} reading the time '
                 f'as text, “The meeting starts at 3:15.” (layer {layer}, averaged over '
                 f'{len(CARRIERS)} sentences). Does the model know the clock goes round?',
        'labels': labels,
        'subs': [words(h, m) for h, m in T],
        'groups': [h % 12 for h, _ in T],
        'group_names': [f'{h} o’clock hour' for h in [12, *range(1, 12)]],
        'thumbs': [thumb(im, 40) for im in ims],
        'notes': {
            'neighbors': 'To the pixels, 11:55’s nearest neighbour is 11:00: the same two hands, swapped. '
                         f'{short} instead files every time under its hour; the minutes barely move it.',
            'cloud': f'{short} lays the hours out like a number line, 1, 2, 3 … 11, 12, with 12 at the far '
                     'end beside 11 rather than just before 1. It reads “12:00” as a number, not as the top of a dial.',
        },
        'cite': ['llama3'],
        'reading': {'barcodes': ['engels']},
        'views': [
            {'name': 'clock face', 'X': P, 'metric': 'euclidean'},
            {'name': f'{short.split("-")[0]} layer {layer}', 'X': H[layer], 'metric': 'euclidean'},
        ],
        'layers': {'names': [f'L{i}' for i in range(len(H))], 'Xs': list(H)},
    }
