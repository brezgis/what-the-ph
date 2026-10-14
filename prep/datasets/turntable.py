from PIL import Image

from ._common import RAW
from ._vision import dino, pixels, thumb

OBJECTS = [(1, 'rubber duck'), (4, 'lucky cat'), (13, 'piggy bank'), (18, 'teacup'), (20, 'cream cheese tub')]
STEP = 2  # every other photo: 36 angles, 10° apart


def load():
    ims, labels, subs, groups = [], [], [], []
    for g, (obj, name) in enumerate(OBJECTS):
        for k in range(0, 72, STEP):
            ims.append(Image.open(RAW / 'coil' / 'coil-20-proc' / f'obj{obj}__{k}.png'))
            labels.append(name)
            subs.append(f'turned {k * 5}°')
            groups.append(g)
    return {
        'title': 'Turntable',
        'blurb': f'{len(OBJECTS)} objects from the COIL-20 photo set, each shot every 10° '
                 'as it spins on a turntable. One view is raw pixels; the other is '
                 'DINOv2, a vision model. A spinning object ought to trace a circle.',
        'labels': labels,
        'subs': subs,
        'groups': groups,
        'group_names': [o[1] for o in OBJECTS],
        'thumbs': [thumb(im, 40) for im in ims],
        'notes': {
            "neighbors": "The teacup changes friends most: from most angles it is a plain bowl, and the handle comes and goes.",
            "rips": "Watch the edges, not the blobs: each object’s ring of photos closes on its own somewhere around ε ≈ 0.3–0.4 and fills in again near 0.5."
        },
        'cite': ['coil20', 'dinov2'],
        'reading': {'rips': ['circular_coords'], 'barcodes': ['ph_images', 'circular_coords']},
        'views': [
            {'name': 'pixels', 'X': pixels(ims, 32), 'metric': 'euclidean'},
            {'name': 'DINOv2', 'X': dino(ims), 'metric': 'cosine'},
        ],
    }
