"""Songbirds: the Passeroidea morphospace of Chia et al. (2026) and its empty ring.

Reproduces their pipeline (scripts/01_clean_trait_data.R, 02_run_pca.R in
Zenodo 10.5281/zenodo.18229068) from AVONET's BirdTree sheet: the 25 passeroid
families, species with their own measurements (no Reference.species), ten traits
logged (all but hand-wing index), z-scored, PCA, first four PCs. This matches
their trait_passeroid_pca.csv exactly (|r| = 1 on every PC, 1378 species).

Their focal gap (H1 feature 468 of data/empirical/tda_0mya.rds) is a loop born
at 0.696 and dying at 1.172 in PC units. raw/songbirds/focal_gap_species.json
lists the 37 species on its representative cycle. We keep the N species closest
to that cycle's centre: a window onto morphospace around the hole. All 37 ring
species fall inside it, and the loop keeps its full-data birth and death and is
the longest H1 bar of the window (a random subsample of 420 spreads the outer
regions thin and invents bigger loops there instead).

View B is what AVONET says about how each species lives: trophic niche, primary
lifestyle, habitat, habitat density and migration as 0/1 columns, plus range
size and how far from the equator the range sits (z-scored).
"""

import base64
import csv
import io
import json
from collections import Counter

import numpy as np
from PIL import Image, ImageDraw

from ._common import RAW

N = 420
FAMILIES = ['Passeridae', 'Prunellidae', 'Urocynchramidae', 'Estrildidae', 'Ploceidae', 'Viduidae',
            'Motacillidae', 'Peucedramidae', 'Fringillidae',
            'Icteridae', 'Parulidae', 'Icteriidae', 'Phaenicophilidae', 'Zeledoniidae', 'Teretistridae',
            'Thraupidae', 'Mitrospingidae', 'Rhodinocichlidae', 'Calyptophilidae', 'Nesospingidae',
            'Spindalidae', 'Cardinalidae', 'Emberizidae', 'Passerellidae', 'Calcariidae']
TRAITS = ['Beak.Length_Culmen', 'Beak.Length_Nares', 'Beak.Width', 'Beak.Depth', 'Tarsus.Length',
          'Wing.Length', 'Secondary1', 'Hand-Wing.Index', 'Tail.Length', 'Mass']
CATS = ['Trophic.Niche', 'Primary.Lifestyle', 'Habitat', 'Habitat.Density', 'Migration']
DENSITY = {'1': 'dense', '2': 'semi-open', '3': 'open'}
MIGRATION = {'1': 'sedentary', '2': 'partial migrant', '3': 'migratory'}
N_GROUPS = 8
D = RAW / 'songbirds'


def _num(s):
    return str(int(float(s))) if s not in ('', 'nan') else ''


def common_names(species3):
    """BirdTree name → English name from the eBird/Clements taxonomy, directly or
    through AVONET's BirdTree→BirdLife→eBird crosswalks."""
    eb = {r['SCIENTIFIC_NAME']: r['COMMON_NAME'] for r in csv.DictReader(open(D / 'ebird_taxonomy.csv', encoding='utf-8'))}
    bt2bl, bl2eb = {}, {}
    for r in csv.DictReader(open(D / 'crosswalk_BirdLife_BirdTree.csv', encoding='utf-8')):
        bt2bl.setdefault(r['Species3'], []).append(r['Species1'])
    for r in csv.DictReader(open(D / 'crosswalk_BirdLife_eBird.csv', encoding='utf-8')):
        bl2eb.setdefault(r['Species1'], []).append(r['Species2'])
    out = []
    for s in species3:
        name = eb.get(s)
        if name is None:
            cands = [e for bl in bt2bl.get(s, []) for e in bl2eb.get(bl, []) if e in eb]
            name = eb[cands[0]] if cands else None
        out.append(name)
    return out


def beak_thumb(lf, df, size=40, ss=4):
    """Ink glyph: a round head in profile with a triangular beak. lf and df in
    [0, 1] place the species' beak length and depth (each relative to body size,
    mass^⅓) between the shortest/shallowest and longest/deepest of the set, so
    the differences are exaggerated on purpose."""
    S = size * ss
    im = Image.new('L', (S, S), 0)
    dr = ImageDraw.Draw(im)
    r = 0.2 * S
    cx, cy = 0.26 * S, 0.5 * S
    dr.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    L = (0.18 + 0.50 * lf) * S          # beak length beyond the face
    h = (0.10 + 0.26 * df) * S          # beak depth at the base
    x0 = cx + 0.75 * r
    dr.polygon([(x0, cy - h / 2), (x0 + L, cy + 0.1 * h), (x0, cy + h / 2)], fill=255)
    im = im.resize((size, size), Image.BOX).point(lambda v: v // 17 * 17)
    buf = io.BytesIO()
    im.save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def morphospace():
    """All 1378 passeroids → (rows, 4-PC scores), as in Chia et al."""
    rows = [r for r in csv.DictReader(open(D / 'AVONET3_BirdTree.csv', encoding='utf-8'))
            if r['Family3'] in FAMILIES and r['Reference.species'] in ('', 'nan')
            and not r['Species3'].startswith('Apteryx')]
    X = np.array([[float(r[t]) for t in TRAITS] for r in rows])
    logged = [i for i, t in enumerate(TRAITS) if t != 'Hand-Wing.Index']
    X[:, logged] = np.log(X[:, logged])
    Z = (X - X.mean(0)) / X.std(0, ddof=1)
    _, _, Vt = np.linalg.svd(Z, full_matrices=False)
    P = Z @ Vt[:4].T
    # their sign convention: PC1 up with mass, PC2 with beak width, PC3 with HWI, PC4 with culmen
    for k, t in enumerate(['Mass', 'Beak.Width', 'Hand-Wing.Index', 'Beak.Length_Culmen']):
        if Vt[k, TRAITS.index(t)] < 0:
            P[:, k] *= -1
    return rows, P


def load():
    rows, P = morphospace()
    gap = json.loads((D / 'focal_gap_species.json').read_text())
    sp = [r['Species3'] for r in rows]
    ring = [sp.index(s) for s in gap['species']]
    centre = P[ring].mean(0)
    keep = np.sort(np.argsort(np.linalg.norm(P - centre, axis=1))[:N])
    assert np.isin(ring, keep).all()
    rows, P = [rows[i] for i in keep], P[keep]
    on_ring = {s for s in gap['species']}

    # B: ecology as 0/1 columns + two geographic numbers
    def cat(r, c):
        v = r[c]
        if c == 'Habitat.Density':
            return DENSITY.get(_num(v), '?')
        if c == 'Migration':
            return MIGRATION.get(_num(v), '?')
        return v or '?'
    levels = {c: sorted({cat(r, c) for r in rows}) for c in CATS}
    onehot = np.array([[1.0 if cat(r, c) == lv else 0.0 for c in CATS for lv in levels[c]] for r in rows])
    def f(v):
        return float(v) if v not in ('', 'nan') else np.nan
    geo = np.array([[np.log(f(r['Range.Size'])), abs(f(r['Centroid.Latitude']))] for r in rows])
    geo = (geo - np.nanmean(geo, 0)) / np.nanstd(geo, 0)
    geo = np.nan_to_num(geo)   # the few species without a range map sit at the average
    B = np.c_[onehot, geo]

    fams = Counter(r['Family3'] for r in rows)
    top = [f for f, _ in fams.most_common(N_GROUPS)]
    groups = [top.index(r['Family3']) if r['Family3'] in top else N_GROUPS for r in rows]

    names = common_names([r['Species3'] for r in rows])
    labels = [n or r['Species3'] for n, r in zip(names, rows)]
    subs = [f"{r['Species3']} · {r['Family3']} · {cat(r, 'Trophic.Niche').lower()}, "
            f"{cat(r, 'Habitat').lower()}" + (' · on the ring around the gap' if r['Species3'] in on_ring else '')
            for r in rows]

    mass3 = np.array([float(r['Mass']) ** (1 / 3) for r in rows])
    cul = np.array([float(r['Beak.Length_Culmen']) for r in rows]) / mass3
    dep = np.array([float(r['Beak.Depth']) for r in rows]) / mass3
    def unit(v):   # log scale, 2nd–98th percentile → 0–1
        lo, hi = np.percentile(np.log(v), [2, 98])
        return np.clip((np.log(v) - lo) / (hi - lo), 0, 1)
    thumbs = [beak_thumb(c, d) for c, d in zip(unit(cul), unit(dep))]

    return {
        'title': 'Songbirds',
        'blurb': f'{len(rows)} finches, sparrows, tanagers, warblers, weavers and their kin '
                 '(the Passeroidea). One view is body plan: ten measurements of beak, '
                 'legs, wings, tail and weight, boiled down to four axes as Chia et al. did. '
                 'In it sits a hole: a kind of bird that could exist but doesn’t. The other '
                 'view is how each species lives. Does ecology know about the gap?',
        'labels': labels,
        'subs': subs,
        'groups': groups,
        'group_names': top + ['other families'],
        'thumbs': thumbs,
        'cite': ['songbirds_chia', 'songbirds_zenodo', 'avonet', 'ebird_clements'],
        'views': [
            {'name': 'body plan', 'X': P, 'metric': 'euclidean'},
            {'name': 'ecology', 'X': B, 'metric': 'euclidean'},
        ],
    }
