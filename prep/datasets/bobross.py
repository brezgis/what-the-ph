import ast
import csv

import numpy as np
from PIL import Image

from ._common import RAW
from ._vision import thumb_orig


def load():
    paints = list(csv.DictReader(open(RAW / 'bob_ross.csv', encoding='utf-8')))
    elems = {r['EPISODE']: r for r in csv.DictReader(open(RAW / 'elements-by-episode.csv'))}
    elem_cols = [c for c in next(iter(elems.values())) if c not in ('EPISODE', 'TITLE')]
    paint_cols = [c for c in paints[0] if c[0].isupper() and c not in ('Unnamed',)]
    paint_cols = [c for c in paint_cols if {r[c].upper() for r in paints} <= {'0', '1', 'TRUE', 'FALSE'}]

    labels, subs, thumbs, A, B = [], [], [], [], []
    for p in paints:
        ep = f'S{int(p["season"]):02d}E{int(p["episode"]):02d}'
        if ep not in elems:
            continue
        e = elems[ep]
        a = [int(e[c]) for c in elem_cols]
        b = [1 if p[c].upper() in ('1', 'TRUE') else 0 for c in paint_cols]
        if not any(a) or not any(b):
            continue
        labels.append(p['painting_title'].strip())
        painting = Image.open(RAW / 'bobross_img' / f'{p["painting_index"]}.png')
        thumbs.append(thumb_orig(painting, 48))
        things = [c.replace('_', ' ').lower() for c, x in zip(elem_cols, a) if x]
        subs.append(f'{ep} · ' + ', '.join(things[:5]) + ('…' if len(things) > 5 else ''))
        A.append(a)
        B.append(b)
    A, B = np.array(A, bool), np.array(B, bool)
    keep = A.any(0)
    return {
        'title': 'The Joy of Painting',
        'blurb': f'All {len(labels)} Bob Ross episodes, twice: what he painted '
                 f'({int(keep.sum())} scene elements, from happy trees to cabins) and '
                 f'which of his {B.shape[1]} paints he reached for.',
        'labels': labels,
        'subs': subs,
        'thumbs': thumbs,
        'thumbs_color': True,
        'notes': {
            "neighbors": "Three percent. Knowing what Bob painted tells you almost nothing about which tubes he opened: most paintings used most of the paints."
        },
        'cite': ['bobross_538', 'bobross_paints'],
        'views': [
            {'name': 'what’s in it', 'X': A[:, keep], 'metric': 'jaccard'},
            {'name': 'paints used', 'X': B, 'metric': 'jaccard'},
        ],
    }
