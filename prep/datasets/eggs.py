"""Bird eggs: shape (Montgomerie et al. 2021) against how the bird flies and lives (AVONET).

Egg data: DATAeggshape.csv from Dryad 10.5061/dryad.sj3tx9648 (CC0; fetched from
its Zenodo mirror 10.5281/zenodo.5826243, because Dryad refuses scripts).
Bird traits: AVONET (Tobias et al. 2022, CC BY 4.0), the eBird-taxonomy sheet
(the egg paper uses Billerman et al. 2020 = Clements/eBird names), falling back
to the BirdTree sheet via the paper's own scinameBT column.
"""

import base64
import csv
import io
from collections import Counter

import numpy as np
from PIL import Image, ImageDraw

from ._common import RAW

N_MAX = 420
LIFESTYLES = ['Aerial', 'Aquatic', 'Insessorial', 'Terrestrial', 'Generalist']
N_GROUPS = 7  # biggest orders get their own colour, the rest are 'other orders'


def egg_thumb(el, pt, size=40, ss=4):
    """Ink-mask silhouette of an egg, pointed end up, drawn from its own shape.

    A warped ellipse: x = cos t runs pole to pole, half-width = sin t / EL
    (half-length 1, so elongation EL = length/breadth). The axis is bent with
    x' = x + d(1 - x²), which leaves both poles in place and slides the widest
    point to x' = d. Pointedness PT is the share of the length from the pointed
    pole to the widest point (Biggins et al. 2018), so d = 1 - 2·PT."""
    d = 1 - 2 * pt                      # < 0: widest point sits toward the blunt pole
    t = np.linspace(0, np.pi, 160)
    x = np.cos(t)
    xs = x + d * (1 - x ** 2)           # +1 = pointed pole, -1 = blunt pole
    hw = np.sin(t) / el                 # half-length is 1, so half-breadth = 1/EL
    S = size * ss
    pad = 1.5 * ss
    k = (S - 2 * pad) / 2               # length 2 in xs units → full height
    cx = S / 2
    # pointed pole at the top
    pts = [(cx + k * h, S / 2 - k * xx) for xx, h in zip(xs, hw)] + \
          [(cx - k * h, S / 2 - k * xx) for xx, h in zip(xs[::-1], hw[::-1])]
    im = Image.new('L', (S, S), 0)
    ImageDraw.Draw(im).polygon(pts, fill=255)
    w = int(np.ceil(2 * k * hw.max() + 2 * pad))   # crop to the egg's own width
    im = im.crop(((S - w) // 2, 0, (S + w) // 2, S)).resize((max(1, round(w / ss)), size), Image.LANCZOS)
    buf = io.BytesIO()
    im.point(lambda v: v // 17 * 17).save(buf, "PNG", optimize=True)   # 16 grey levels: smaller
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def _rows():
    eggs = list(csv.DictReader(open(RAW / 'eggs' / 'DATAeggshape.csv', encoding='utf-8')))
    av2 = {r['Species2']: r for r in csv.DictReader(open(RAW / 'songbirds' / 'AVONET2_eBird.csv', encoding='utf-8'))}
    av3 = {r['Species3']: r for r in csv.DictReader(open(RAW / 'songbirds' / 'AVONET3_BirdTree.csv', encoding='utf-8'))}
    out = []
    for e in eggs:
        a = av2.get(e['sciname']) or av3.get(e['scinameBT'])   # 5 extinct species have neither
        if a is None:
            continue
        need = [e['avEL'], e['avPA'], e['avPT'], a['Hand-Wing.Index'], a['Wing.Length'], a['Mass'], a['Tarsus.Length']]
        if any(v in ('', 'NA', 'nan') for v in need):
            continue
        out.append((e, a))
    return out


def _subsample(rows, n_max, seed=0):
    """Stratified by order: every order keeps the same share of its species
    (at least one), so the rarer orders aren't drowned by songbirds."""
    if len(rows) <= n_max:
        return rows
    rng = np.random.default_rng(seed)
    by = {}
    for i, (e, _) in enumerate(rows):
        by.setdefault(e['Order'], []).append(i)
    frac = n_max / len(rows)
    keep = []
    for order, idx in by.items():
        k = max(1, int(round(len(idx) * frac)))
        keep += sorted(rng.choice(idx, size=min(k, len(idx)), replace=False).tolist())
    keep = sorted(keep)[:n_max] if len(keep) > n_max else sorted(keep)
    return [rows[i] for i in keep]


def z(X):
    X = np.asarray(X, float)
    return (X - X.mean(0)) / X.std(0)


def load():
    rows = _subsample(_rows(), N_MAX)
    # A: shape only (size would just restate body mass); PA is skewed, so logged
    A = z([[float(e['avEL']), np.log(float(e['avPA'])), float(e['avPT'])] for e, _ in rows])
    # B: flight + build, z-scored, plus primary lifestyle as 0/1 columns
    B_num = z([[float(a['Hand-Wing.Index']), np.log(float(a['Wing.Length'])),
                np.log(float(a['Mass'])), np.log(float(a['Tarsus.Length']))] for _, a in rows])
    B_cat = np.array([[1.0 if a['Primary.Lifestyle'] == s else 0.0 for s in LIFESTYLES] for _, a in rows])
    B = np.c_[B_num, B_cat]

    orders = Counter(e['Order'] for e, _ in rows)
    top = [o for o, _ in orders.most_common(N_GROUPS)]
    groups = [top.index(e['Order']) if e['Order'] in top else N_GROUPS for e, _ in rows]

    labels = [e['common'].strip() or e['sciname'] for e, _ in rows]
    subs = [f"{e['sciname']} · {e['Order']} · elongation {float(e['avEL']):.2f}, "
            f"pointedness {float(e['avPT']):.2f} · hand-wing index {float(a['Hand-Wing.Index']):.0f}"
            for e, a in rows]
    thumbs = [egg_thumb(float(e['avEL']), float(e['avPT'])) for e, _ in rows]
    return {
        'title': 'Bird eggs',
        'blurb': f'{len(rows)} bird species, from hummingbirds to ostriches. One view is the '
                 'shape of their eggs (how long, how lopsided, how pointed); the other is '
                 'how the bird flies and lives: wing shape, size, legs, lifestyle. Do '
                 'strong fliers lay pointier eggs?',
        'labels': labels,
        'subs': subs,
        'groups': groups,
        'group_names': [o for o in top] + ['other orders'],
        'thumbs': thumbs,
        'cite': ['eggshape_montgomerie', 'eggshape_dryad', 'eggshape_biggins', 'avonet'],
        'views': [
            {'name': 'egg shape', 'X': A, 'metric': 'euclidean'},
            {'name': 'how it flies & lives', 'X': B, 'metric': 'euclidean'},
        ],
    }
