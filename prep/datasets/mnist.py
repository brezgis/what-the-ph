import gzip

import numpy as np
from PIL import Image

from ._common import RAW
from ._vision import dino, pixels, thumb

PER_DIGIT = 30


def load():
    X = np.frombuffer(gzip.open(RAW / 't10k-images.gz').read(), np.uint8, offset=16).reshape(-1, 28, 28)
    y = np.frombuffer(gzip.open(RAW / 't10k-labels.gz').read(), np.uint8, offset=8)
    idx = [i for d in range(10) for i in np.flatnonzero(y == d)[:PER_DIGIT]]
    ims = [Image.fromarray(X[i]) for i in idx]
    words = 'zero one two three four five six seven eight nine'.split()
    return {
        'title': 'MNIST',
        'blurb': f'The most famous handwriting in machine learning: {len(idx)} digits '
                 f'from the MNIST test set, {PER_DIGIT} of each. Pixels versus DINOv2, '
                 'a vision model that never saw a digit in training.',
        'labels': [words[y[i]] for i in idx],
        'subs': [f'test image #{i}' for i in idx],
        'groups': [int(y[i]) for i in idx],
        'group_names': words,
        'thumbs': [thumb(im, 28) for im in ims],
        'notes': {
            "rsa": "Almost no agreement. In pixel space two digits are close only when their ink lands on the same squares; DINOv2, trained on photos, is looking at something else entirely: stroke weight, slant, overall blobness."
        },
        'cite': ['mnist', 'dinov2'],
        'reading': {'barcodes': ['ph_images']},
        'views': [
            {'name': 'pixels', 'X': pixels(ims, 28), 'metric': 'euclidean'},
            {'name': 'DINOv2', 'X': dino(ims), 'metric': 'cosine'},
        ],
    }
