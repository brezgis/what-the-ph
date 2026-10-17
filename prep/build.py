"""Precompute everything the page shows.

Per dataset: data/<id>.json (labels, thumbnails, CKA, citations…) plus one
data/<id>/<metric>.json per distance that makes sense for it (everything that
depends on the distance: MDS shadow, barcodes, RSA, neighbors, TwoNN…).

    uv run python build.py              # every dataset
    uv run python build.py candy clock  # just these

A dataset module (datasets/<id>.py) exposes `load()` returning a dict:

    title, blurb            strings for the page
    labels                  list of n hover labels
    subs   (optional)       list of n secondary labels
    groups (optional)       list of n small ints, plus `group_names`
    thumbs (optional)       list of n grayscale PNG data URIs (brightness = ink)
    notes  (optional)       {step key: html} extra asides for particular steps
    cite   (optional)       keys into js/refs.js for the data and models used
    reading (optional)      {step key: [ref keys]} papers about this data + lens
    metrics (optional)      distance keys to offer, when only some mean anything here
    views                   two dicts: {name, X (n×d array), metric}  (metric = its natural distance)
    layers (optional)       {names: [...], Xs: [arrays]} for the CKA heatmap

The page never computes geometry itself; it only animates what is in here.
Distances are normalised so the largest pairwise distance in each view is 1,
which makes the ε slider mean the same thing for every dataset. The condensed
distance list is stored as integers in thousandths to keep the files small.
"""

import importlib
import json
import os
import sys
from pathlib import Path

import numpy as np
from ripser import ripser
from scipy.cluster.hierarchy import leaves_list, linkage
from scipy.spatial.distance import pdist, squareform
from scipy.stats import spearmanr

HERE = Path(__file__).parent
OUT = HERE.parent / 'data'
K = 5  # neighbors for the overlap lens

DATASETS = ['layers', 'clock', 'numbers', 'clocks', 'grambank', 'states',
            'turntable', 'doodles', 'mnist', 'emoji', 'pokemon',
            'stars', 'cities', 'elements', 'songbirds', 'eggs', 'orbits', 'fungi', 'cellcycle',
            'candy', 'bobross']


GEO_K = 10  # neighbors in the graph that geodesic distance walks along


def raw_distances(X, metric):
    X = np.asarray(X, dtype=float)
    if metric == 'standardized':
        sd = X.std(0)
        X = X[:, sd > 1e-9] / sd[sd > 1e-9]   # every feature gets the same spread
        metric = 'euclidean'
    if metric == 'geodesic':
        # shortest paths through the symmetrised k-nearest-neighbor graph (as in Isomap)
        from scipy.sparse import csr_matrix
        from scipy.sparse.csgraph import shortest_path
        E = squareform(pdist(X))
        Einf = E.copy()
        np.fill_diagonal(Einf, np.inf)   # never your own neighbour, even with duplicates
        k = min(GEO_K, len(X) - 1)
        nn = np.argsort(Einf, axis=1)[:, :k]
        rows = np.repeat(np.arange(len(X)), k)
        G = np.zeros_like(E)
        G[rows, nn.ravel()] = E[rows, nn.ravel()]
        G[rows, nn.ravel()] = np.maximum(G[rows, nn.ravel()], 1e-9)  # duplicates: keep the edge
        G = np.maximum(G, G.T)
        # bridge separate islands with their shortest connecting edge (as Isomap
        # implementations do), until the graph is one piece
        from scipy.sparse.csgraph import connected_components
        while True:
            k, lab = connected_components(csr_matrix(G), directed=False)
            if k == 1:
                break
            a = lab == 0
            sub = E[np.ix_(a, ~a)]
            i, j = np.unravel_index(np.argmin(sub), sub.shape)
            i, j = np.flatnonzero(a)[i], np.flatnonzero(~a)[j]
            G[i, j] = G[j, i] = max(E[i, j], 1e-9)   # 0 would read as 'no edge'
        return shortest_path(csr_matrix(G), directed=False)
    D = squareform(pdist(X, metric=metric))
    return np.nan_to_num(D, nan=1.0)           # jaccard/correlation of degenerate rows


def distances(X, metric):
    D = raw_distances(X, metric)
    return D / D.max()


def classical_mds(D, k=3, kept=False):
    """Classical (Torgerson) MDS: the k-D layout whose inner products best match
    the double-centred squared distances. With kept=True also returns the share
    of the positive spectrum those k axes hold."""
    n = len(D)
    J = np.eye(n) - 1 / n
    B = -0.5 * J @ (D ** 2) @ J
    w, V = np.linalg.eigh(B)
    order = np.argsort(w)[::-1][:k]
    Y = V[:, order] * np.sqrt(np.maximum(w[order], 0))
    Y = Y / np.abs(Y).max()
    if kept:
        pos = w[w > 0].sum()
        return Y, float(np.maximum(w[order], 0).sum() / pos) if pos > 0 else 0.0
    return Y


def procrustes(A, B):
    """Rotate/reflect + scale B onto A (both centered). Returns B', disparity."""
    A = A - A.mean(0)
    B = B - B.mean(0)
    A = A / np.linalg.norm(A)
    B = B / np.linalg.norm(B)
    U, s, Vt = np.linalg.svd(B.T @ A)
    R = U @ Vt
    B2 = s.sum() * B @ R
    return A, B2, float(((A - B2) ** 2).sum())


def linear_cka(X, Y):
    X = X - X.mean(0)
    Y = Y - Y.mean(0)
    xy = np.linalg.norm(Y.T @ X) ** 2
    return float(xy / (np.linalg.norm(X.T @ X) * np.linalg.norm(Y.T @ Y)))


def knn(D, k):
    D = D.copy()
    np.fill_diagonal(D, np.inf)
    return np.argsort(D, axis=1)[:, :k]


def two_nn(D, dims=None):
    """TwoNN intrinsic dimension (Facco et al. 2017), maximum-likelihood form:
    d = N / sum(log mu), mu = r2/r1. Exact duplicates are collapsed first (they
    have r1 = 0). Returns (d or None, kept, unique, sorted mu). d is None when too
    few distinct points remain for the number to mean anything."""
    D = D.copy()
    np.fill_diagonal(D, np.inf)
    # keep one representative of each group of identical points
    dup = np.zeros(len(D), bool)
    for i in range(len(D)):
        if not dup[i]:
            dup |= (D[i] < 1e-9) & (np.arange(len(D)) > i)
    U = D[~dup][:, ~dup]
    r = np.sort(U, axis=1)[:, :2]
    mu = r[:, 1] / np.maximum(r[:, 0], 1e-12)
    mu = mu[np.isfinite(mu)]          # no second neighbor (too few distinct points)
    unique = int((~dup).sum())
    s = np.log(mu).sum()
    ties = float((mu <= 1 + 1e-9).mean())          # r1 == r2: the ratio carries no information
    ok = unique >= max(8, len(D) // 2) and ties <= 0.25 and s > 0
    d = float(len(mu) / s) if ok else None
    if d is not None and dims is not None and d > dims:
        d = None                                    # more dimensions than coordinates: an artifact
    return d, len(mu), unique, sorted(round(float(m), 4) for m in mu)


def barcode(D, maxdim=1):
    dgms = ripser(D, distance_matrix=True, maxdim=maxdim)['dgms']
    out = []
    for dim, dgm in enumerate(dgms):
        for b, d in dgm:
            if d - b < 1e-6:
                continue
            out.append([dim, round(float(b), 4), None if np.isinf(d) else round(float(d), 4)])
    return out


def r(a, nd=4):
    return np.round(np.asarray(a, dtype=float), nd).tolist()


def is_binary(X):
    return bool(np.isin(np.unique(X), [0, 1]).all())


def metric_options(views):
    """Which distances make sense here. One metric always applies to both views,
    so comparisons are like with like. Default: the first view's own metric."""
    binary = [is_binary(v['X']) for v in views]
    opts = []
    for m in ('euclidean', 'cosine', 'cityblock', 'chebyshev', 'correlation', 'standardized', 'geodesic', 'jaccard'):
        if m == 'jaccard' and not all(binary):
            continue
        if m == 'chebyshev' and any(binary):
            continue   # on yes/no features nearly every pair is exactly 1 apart
        if m == 'standardized' and any(binary):
            continue
        opts.append((m, [m, m]))
    keys = [k for k, _ in opts]
    default = views[0]['metric'] if views[0]['metric'] in keys else 'euclidean'
    return opts, default


def geometry(views, metrics, maxdim=1):
    """Everything that depends on the choice of distance."""
    n = len(views[0]['X'])
    Ds = [distances(v['X'], m) for v, m in zip(views, metrics)]
    Ys = [classical_mds(D) for D in Ds]
    # a flat (2-D) Euclidean view is already a picture: show it as itself, z = 0,
    # so a periodic table looks like a periodic table (distances are unchanged)
    for i, (v, m) in enumerate(zip(views, metrics)):
        if v['X'].shape[1] == 2 and m == 'euclidean':
            P = np.asarray(v['X'], float) - np.asarray(v['X'], float).mean(0)
            P = P / np.abs(P).max()
            Ys[i] = np.column_stack([P, np.zeros(len(P))])
    A3, B3, _ = procrustes(Ys[0], Ys[1])
    # disparity measured in a common higher-dim MDS space, not just the 3-D picture;
    # few dimensions for few points, or the rotation can fit anything
    kk = max(2, min(10, n // 4))
    Ak, Bk = classical_mds(Ds[0], kk), classical_mds(Ds[1], kk)
    _, _, disparity = procrustes(Ak, Bk)
    # what pure chance looks like: the same fit after shuffling who is who
    rng = np.random.default_rng(0)
    chance = float(np.mean([procrustes(Ak, Bk[rng.permutation(n)])[2] for _ in range(20)]))
    iu = np.triu_indices(n, 1)
    nn = [knn(D, K) for D in Ds]
    # does the choice of distance matter? rank agreement with plain Euclidean, per view
    vs = [float(spearmanr(D[iu], distances(v['X'], 'euclidean')[iu]).statistic) for v, D in zip(views, Ds)]
    out = {
        'vsEuclid': [round(x, 3) for x in vs],
        'procrustes': {'a': r(A3), 'b': r(B3), 'disparity': round(disparity, 4), 'chance': round(chance, 4), 'dims': kk},
        'rsa': round(float(spearmanr(Ds[0][iu], Ds[1][iu]).statistic), 4),
        'knn': {'k': K, 'overlap': [len(set(nn[0][i]) & set(nn[1][i])) / K for i in range(n)]},
        # seriation for the distance-matrix picture: average-linkage leaves of view A
        'order': leaves_list(linkage(Ds[0][iu], 'average')).tolist(),
        'views': [],
    }
    for v, m, D, Y, nb in zip(views, metrics, Ds, Ys, nn):
        idim, kept_pts, unique, mu = two_nn(D, v['X'].shape[1])
        _, spread = classical_mds(D, 3, kept=True)
        out['views'].append({
            'metric': m,
            'mdsKept': round(spread, 3),
            'twoNNkept': kept_pts,
            'unique': unique,
            'xyz': r(Y),
            'dist': np.round(D[iu] * 1000).astype(int).tolist(),  # condensed, in ‰
            'bars': barcode(D, maxdim),
            'nbrs': nb.tolist(),
            'twoNN': None if idim is None else round(idim, 2),
            'mu': mu,
        })
    return out


def build(ds_id):
    spec = importlib.import_module(f'datasets.{ds_id}').load()
    n = len(spec['labels'])
    views = spec['views']
    opts, default = metric_options(views)
    if spec.get('metrics'):   # a dataset can say only some distances mean anything for it
        opts = [o for o in opts if o[0] in spec['metrics']]
        default = default if default in spec['metrics'] else opts[0][0]

    base = {
        'id': ds_id,
        'title': spec['title'],
        'blurb': spec['blurb'],
        'n': n,
        'labels': spec['labels'],
        'subs': spec.get('subs'),
        'labelsB': spec.get('labels_b'),
        'groups': spec.get('groups'),
        'groupNames': spec.get('group_names'),
        'thumbs': spec.get('thumbs'),
        'thumbsColor': bool(spec.get('thumbs_color')),  # thumbs are real colors, not ink masks
        'notes': spec.get('notes'),
        'glyphs': spec.get('glyphs'),
        'cite': spec.get('cite'),        # keys into js/refs.js
        'reading': spec.get('reading'),  # {lens key: [ref keys]} dataset-specific papers
        'views': [{'name': v['name'], 'dims': int(v['X'].shape[1])} for v in views],
        # CKA works on the raw features, so it doesn't depend on the distance
        'cka': round(linear_cka(views[0]['X'], views[1]['X']), 4),
        # chance level: CKA after shuffling which row of B goes with which row of A
        'ckaChance': round(float(np.mean([linear_cka(views[0]['X'], views[1]['X'][np.random.default_rng(s).permutation(n)])
                                          for s in range(20)])), 4),
        'metrics': [{'key': k, 'views': ms} for k, ms in opts],
        'h2': bool(spec.get('h2')),
        'defaultMetric': default,
    }
    if 'layers' in spec:
        Xs = spec['layers']['Xs']
        base['layers'] = {
            'names': spec['layers']['names'],
            'cka': [[round(linear_cka(a, b), 3) for b in Xs] for a in Xs],
        }

    from datasets import _about
    _about.apply(base)   # official name + quoted descriptions

    OUT.mkdir(exist_ok=True)
    (OUT / ds_id).mkdir(exist_ok=True)
    path = OUT / f'{ds_id}.json'
    path.write_text(json.dumps(base, ensure_ascii=False, separators=(',', ':'), allow_nan=False))
    print(f'{ds_id:9s} n={n:4d}  cka={base["cka"]:.2f} (chance {base["ckaChance"]:.2f})  base {path.stat().st_size // 1024} KB')
    only = os.environ.get('ONLY_METRICS')
    for key, ms in opts:
        if only and key not in only.split(','):
            continue
        # voids (H2) only where a sphere is expected: they cost ~20 s per view at n≈450
        g = geometry(views, ms, maxdim=2 if spec.get('h2') else 1)
        gp = OUT / ds_id / f'{key}.json'
        gp.write_text(json.dumps(g, separators=(',', ':'), allow_nan=False))
        h1 = [sum(1 for b in v['bars'] if b[0] >= 1) for v in g['views']]
        print(f'   {key:9s} rsa={g["rsa"]:.2f}  id={g["views"][0]["twoNN"]}/{g["views"][1]["twoNN"]}  '
              f'proc={g["procrustes"]["disparity"]:.2f} (chance {g["procrustes"]["chance"]:.2f})  '
              f'H1 bars={h1}  {gp.stat().st_size // 1024} KB')


if __name__ == '__main__':
    ids = sys.argv[1:] or DATASETS
    for ds in ids:
        if not (HERE / 'datasets' / f'{ds}.py').exists():
            print(f'{ds:9s} (no module yet, skipped)')
            continue
        build(ds)
    manifest = [json.loads((OUT / f'{d}.json').read_text())['title'] for d in DATASETS
                if (OUT / f'{d}.json').exists()]
    (OUT / 'index.json').write_text(json.dumps(
        [{'id': d, 'title': t} for d, t in zip(
            [d for d in DATASETS if (OUT / f'{d}.json').exists()], manifest)],
        ensure_ascii=False))
