#!/usr/bin/env python3
"""Where each persistence bar lives: add `gens` to data/<id>/<metric>.json.

The barcodes themselves come from ripser in build.py and are left untouched.
This pass reruns the persistence computation with gudhi, which reports the
edges that create and destroy each class, and pins those edges onto the
existing bars. The browser draws a feature from them:

    H0 bar  ->  [u, v]           the edge that merges this piece into an older one
    H1 bar  ->  [bu, bv, du, dv] the edge that closes the loop, and the one whose
                                 triangle fills it; the loop itself is the birth
                                 edge plus the shortest path between its ends
    H2 bar  ->  same, for the shell that closes and the chord that fills the void

Distances are rebuilt from the stored thousandths, so a pair is matched to a
bar within a small tolerance; a bar without a match gets null (the page then
says it can't point at that one rather than guessing).

    uv run --with gudhi python generators.py            # every dataset
    uv run --with gudhi python generators.py stars      # just these (skips files already done)
    uv run --with gudhi python generators.py --force    # redo everything

Rerun after build.py: it rewrites the geometry files without `gens`.
"""
import json
import resource
import sys
import time
from pathlib import Path

import gudhi
import numpy as np
from scipy.optimize import linear_sum_assignment

DATA = Path(__file__).resolve().parent.parent / 'data'
TOL = 0.004
VOIDS = 10    # H2 bars located per view (the longest ones)   # ‰ rounding on both ends, plus ripser's own 4-decimal rounding


def condensed_to_square(dist, n):
    D = np.zeros((n, n))
    iu = np.triu_indices(n, 1)
    D[iu] = np.asarray(dist, float) / 1000
    return D + D.T


def gudhi_pairs(D, dim, threshold):
    """[(birth, death, generator)] for one homology dimension, finite bars only.

    For loops and voids the graph is edge-collapsed first (Boissonnat & Pritam):
    the barcode is unchanged, the complex is a fraction of the size (the full one
    needs ~30 GB for voids at n = 300). Births and deaths are read off the
    collapsed complex, so they are exactly the bar's values."""
    st = gudhi.RipsComplex(distance_matrix=D, max_edge_length=threshold).create_simplex_tree(max_dimension=1)
    if dim > 0:
        st.collapse_edges(nb_iterations=10)
        st.expansion(dim + 1)
    st.compute_persistence(persistence_dim_max=True)
    reg0, regh, _, _ = st.flag_persistence_generators()
    out = []
    if dim == 0:
        for _, u, v in reg0:
            d = D[u, v]
            if d > 1e-9:
                out.append((0.0, d, [int(u), int(v)]))
    elif len(regh) >= dim:
        for bu, bv, du, dv in regh[dim - 1]:
            b, d = st.filtration([int(bu), int(bv)]), st.filtration([int(du), int(dv)])
            if d - b > 1e-9:
                out.append((b, d, [int(bu), int(bv), int(du), int(dv)]))
    return out


def match(bars, pairs):
    """Assign gudhi pairs to stored bars by nearest (birth, death)."""
    gens = [None] * len(bars)
    if not bars or not pairs:
        return gens, 0
    B = np.array([[b[1], b[2]] for b in bars])
    G = np.array([[p[0], p[1]] for p in pairs])
    cost = np.abs(B[:, None, 0] - G[None, :, 0]) + np.abs(B[:, None, 1] - G[None, :, 1])
    rows, cols = linear_sum_assignment(np.where(cost <= TOL, cost, 10.0))
    hit = 0
    for r, c in zip(rows, cols):
        if cost[r, c] <= TOL:
            gens[r] = pairs[c][2]
            hit += 1
    return gens, hit


def view_gens(view, n):
    D = condensed_to_square(view['dist'], n)
    bars = view['bars']
    gens = [None] * len(bars)
    report = []
    for dim in (0, 1, 2):
        idx = [k for k, b in enumerate(bars) if b[0] == dim and b[2] is not None]
        if not idx:
            continue
        if dim == 2:
            # voids are costly (a 3-skeleton): locate the ten most persistent,
            # which bounds how far the complex has to be built
            idx = sorted(idx, key=lambda k: bars[k][1] - bars[k][2])[:VOIDS]
        top = max(bars[k][2] for k in idx) + 0.003
        try:
            pairs = gudhi_pairs(D, dim, min(1.0, top))
        except MemoryError:
            # too big under the memory cap: these bars stay unlocated (the page says so)
            report.append(f'H{dim} skipped (memory)')
            continue
        g, hit = match([bars[k] for k in idx], pairs)
        for k, x in zip(idx, g):
            gens[k] = x
        report.append(f'H{dim} {hit}/{len(idx)}')
    return gens, report


def main(only):
    for base in sorted(DATA.glob('*.json')):
        if base.name == 'index.json' or (only and base.stem not in only):
            continue
        meta = json.loads(base.read_text())
        n = meta['n']
        for gp in sorted((DATA / base.stem).glob('*.json')):
            t = time.time()
            g = json.loads(gp.read_text())
            if not FORCE and all('gens' in v for v in g['views']):
                continue   # done already (--force redoes it)
            reports = []
            for v in g['views']:
                v['gens'], rep = view_gens(v, n)
                reports.append(', '.join(rep))
            gp.write_text(json.dumps(g, separators=(',', ':'), allow_nan=False))
            print(f'{base.stem}/{gp.stem}: {" | ".join(reports)}  ({time.time() - t:.1f}s)', flush=True)


if __name__ == '__main__':
    # a shared machine: fail with MemoryError rather than squeeze everyone else
    resource.setrlimit(resource.RLIMIT_AS, (12 << 30, 12 << 30))
    FORCE = '--force' in sys.argv
    main(set(a for a in sys.argv[1:] if not a.startswith('--')))
