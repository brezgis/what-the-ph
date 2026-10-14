"""Cell cycle: FUCCI U2OS single cells (Mahdessian et al. 2021), a textbook loop.

Source: GEO GSE146773 supplementary files, saved under raw/cellcycle/:
    https://ftp.ncbi.nlm.nih.gov/geo/series/GSE146nnn/GSE146773/suppl/GSE146773_fucci_coords.csv.gz
    https://ftp.ncbi.nlm.nih.gov/geo/series/GSE146nnn/GSE146773/suppl/GSE146773_Counts.csv.gz

Every cell was FACS-sorted with its two FUCCI reporter intensities recorded
(green: Geminin, rises in S/G2/M; red: Cdt1, high in G1), then sequenced with
SMART-seq2. The authors' `fucci_time_hrs` is the cell's position around the
FUCCI ring, converted to hours.

View A: the two log intensities, as the authors rescaled them (2-D, euclidean).
  These draw a horseshoe, not a closed ring: at division both reporters reset,
  so the late-G2/M end and the early-G1 end sit apart. (A_MODE = 'angle' would
  use the authors' polar angle as a point on a circle instead: a perfect loop,
  but one the authors imposed.)
View B: log CPM of the 500 highest-variance genes (expressed in >10% of cells)
  → first 5 principal components (euclidean). The loop is visible in PC1–2;
  more components mostly add sequencing noise and blur it for persistent
  homology (checked 3/5/10/20; 5 gave the clearest H1).

Thumbnails: a soft dot coloured the way the nucleus looks under the microscope
(red Cdt1 + green Geminin, from the two intensities), so G1 is red, S yellowish,
G2/M green.
"""

import base64
import csv
import gzip
import io

import numpy as np

from ._common import RAW

R = RAW / 'cellcycle'
N = 400
N_GENES = 500
N_PCS = 5
A_MODE = 'intensity'   # or 'angle'
MIN_GENES = 3000          # drop shallow / failed libraries before sampling


def _counts(cells):
    want = set(cells)
    rows = {}
    with gzip.open(R / 'GSE146773_Counts.csv.gz', 'rt') as f:
        genes = f.readline().rstrip('\n').split(',')[1:]
        for line in f:
            cell, rest = line.split(',', 1)
            if cell in want:
                rows[cell] = np.array(rest.split(','), dtype=np.float32)
    return genes, rows


def _dot(green, red, size=16):
    """A soft nucleus-like dot: red = Cdt1 reporter, green = Geminin reporter
    (both already scaled to 0..1)."""
    from PIL import Image
    g = float(np.clip(green, 0, 1))
    r = float(np.clip(red, 0, 1))
    k = max(g, r, 1e-6)
    rgb = np.array([255 * r / k, 255 * g / k, 40.0])
    yy, xx = np.mgrid[:size, :size] - (size - 1) / 2
    a = np.exp(-(np.hypot(xx, yy) / (size * 0.3)) ** 4)
    img = np.dstack([np.broadcast_to(rgb, (size, size, 3)), a[..., None] * 255]).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(img, 'RGBA').save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def load():
    fucci = [r for r in csv.DictReader(gzip.open(R / 'GSE146773_fucci_coords.csv.gz', 'rt'))]
    genes, counts = _counts([r['cell'] for r in fucci])
    # ERCC spike-ins are a separate file; drop any that slipped into the gene list
    keep_g = np.array([not g.startswith('ERCC') for g in genes])
    fucci = [r for r in fucci if r['cell'] in counts and (counts[r['cell']] > 0).sum() >= MIN_GENES]
    fucci.sort(key=lambda r: float(r['fucci_time_hrs']))
    # even sampling around the cycle: the cell nearest each of N evenly spaced times
    t = np.array([float(r['fucci_time_hrs']) for r in fucci])
    picks, used = [], set()
    for target in np.linspace(t.min(), t.max(), N):
        for j in np.argsort(np.abs(t - target)):
            if j not in used:
                used.add(j)
                picks.append(j)
                break
    picks.sort()
    cells = [fucci[j] for j in picks]

    C = np.stack([counts[r['cell']][keep_g] for r in cells]).astype(float)
    L = np.log1p(C / C.sum(1, keepdims=True) * 1e6)      # log CPM
    # most variable genes among reasonably expressed ones
    ok = (C > 0).mean(0) > 0.1
    top = np.argsort(np.where(ok, L.var(0), -np.inf))[::-1][:N_GENES]
    G = L[:, top]
    G = G - G.mean(0)
    U, s, _ = np.linalg.svd(G, full_matrices=False)
    B = U[:, :N_PCS] * s[:N_PCS]

    A = np.array([[float(r['green530_lognorm_rescale']), float(r['red585_lognorm_rescale'])] for r in cells])
    hi = np.percentile(A, 97, axis=0)
    thumbs = [_dot(g, r) for g, r in A / hi]
    if A_MODE == 'angle':
        phi = np.array([float(r['polar_coord_phi']) for r in cells])
        A = np.stack([np.cos(phi), np.sin(phi)], 1)
    phase_map = {'G1': 0, 'S-ph': 1, 'G2M': 2}
    phase = [r['phase_by_facs_gating'] for r in cells]
    groups = [phase_map.get(p, 3) for p in phase]
    nice = {'G1': 'G1', 'S-ph': 'S', 'G2M': 'G2/M', 'N/A': 'between gates'}
    return {
        'title': 'Cell cycle',
        'blurb': f'{N} human bone-cancer cells (U2OS) caught at every point of the cycle. '
                 'Each glows in two colors that rise and fall as it grows and divides; '
                 'each also had all its genes read. Do the colors and the genes trace the same loop?',
        'labels': [f'cell {r["cell"]}' for r in cells],
        'subs': [f'{nice[p]} · {float(r["fucci_time_hrs"]):.1f} h into the cycle' for p, r in zip(phase, cells)],
        'groups': groups,
        'group_names': ['G1', 'S', 'G2/M', 'between gates'],
        'thumbs': thumbs,
        'thumbs_color': True,
        'cite': ['mahdessian2021'],
        'views': [
            {'name': 'FUCCI colors', 'X': A, 'metric': 'euclidean'},
            {'name': 'genes', 'X': B, 'metric': 'euclidean'},
        ],
    }
