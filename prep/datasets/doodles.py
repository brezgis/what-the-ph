import ast

import numpy as np
from PIL import Image, ImageOps

from ._common import RAW
from ._vision import dino, pixels, thumb

CATEGORIES = ['cat', 'clock', 'moon', 'bicycle', 'sun', 'fish', 'snail', 'donut']
PER = 30


def first_rows(path, k):
    """The first k drawings of a Quick, Draw! .npy, from a partial (byte-range) download."""
    raw = open(path, 'rb').read()
    hlen = int.from_bytes(raw[8:10], 'little')
    header = ast.literal_eval(raw[10:10 + hlen].decode('latin1'))
    width = header['shape'][1]
    body = np.frombuffer(raw[10 + hlen:], np.uint8)
    return body[: k * width].reshape(k, 28, 28)


def load():
    ims, labels, groups = [], [], []
    for g, c in enumerate(CATEGORIES):
        for a in first_rows(RAW / 'quickdraw' / f'{c}.part', PER):
            ims.append(Image.fromarray(a))
            labels.append(c)
            groups.append(g)
    # DINO sees black-on-white like a person would; the thumbnail keeps ink = bright
    seen = [ImageOps.invert(im) for im in ims]
    return {
        'title': 'Quick, Draw!',
        'blurb': f'{len(ims)} doodles from Google’s Quick, Draw! game, where strangers had '
                 f'20 seconds to draw a {", a ".join(CATEGORIES[:-1])} or a {CATEGORIES[-1]}. '
                 'Pixels versus DINOv2.',
        'labels': labels,
        'subs': [f'doodle #{k % PER + 1}' for k in range(len(ims))],
        'groups': groups,
        'group_names': CATEGORIES,
        'thumbs': [thumb(im, 28) for im in ims],
        'notes': {
            "neighbors": "Pixels think two doodles are close when their lines happen to land on the same squares. DINOv2 cares more about what they are drawings of. They rarely agree.",
            "dimension": "Pixels claim far more dimensions than DINOv2: scribbles vary in every direction, while the model squeezes them onto a few meaningful axes."
        },
        'cite': ['quickdraw', 'quickdraw_page', 'dinov2'],
        'reading': {'barcodes': ['ph_images']},
        'views': [
            {'name': 'pixels', 'X': pixels(ims, 28), 'metric': 'euclidean'},
            {'name': 'DINOv2', 'X': dino(seen), 'metric': 'cosine'},
        ],
    }
