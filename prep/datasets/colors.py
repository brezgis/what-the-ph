"""Ekman's colours: how alike 14 spectral lights look, vs. where they sit on the CIE chart.

Ekman (1954) had 31 people rate every pair of 14 spectral colours, 434–674 nm,
on a five-step scale from 0 (no similarity) to 4 (identical). The averaged
ratings, divided by 4, are the classic matrix Shepard (1962) turned into a
colour circle. The numbers below are that matrix as distributed with the R
package smacof (data `ekman`, v2.1-7), checked against its documentation; the
dissimilarity is 1 − similarity.

The other view is the light itself: each wavelength's CIE 1976 u′v′
chromaticity, from the CIE 1931 2° colour-matching functions (CIE 018:2019,
Table 6, CC BY-SA 4.0). Chromaticity leaves brightness out, so no white point or
luminance has to be assumed. Along the spectrum the points trace an open arc;
the judgments are free to bend violet back towards red.
"""

import base64
import io

import numpy as np
from PIL import Image, ImageDraw
from scipy.spatial.distance import squareform

from ._common import RAW

CMF = RAW / 'colors' / 'CIE_xyz_1931_2deg.csv'

NM = [434, 445, 465, 472, 490, 504, 537, 555, 584, 600, 610, 628, 651, 674]

# Ekman (1954) similarities, R `dist` order: (2,1), (3,1), …, (14,1), (3,2), …
SIM = [
    0.86, 0.42, 0.42, 0.18, 0.06, 0.07, 0.04, 0.02, 0.07, 0.09, 0.12, 0.13, 0.16,
    0.50, 0.44, 0.22, 0.09, 0.07, 0.07, 0.02, 0.04, 0.07, 0.11, 0.13, 0.14,
    0.81, 0.47, 0.17, 0.10, 0.08, 0.02, 0.01, 0.02, 0.01, 0.05, 0.03,
    0.54, 0.25, 0.10, 0.09, 0.02, 0.01, 0.00, 0.01, 0.02, 0.04,
    0.61, 0.31, 0.26, 0.07, 0.02, 0.02, 0.01, 0.02, 0.00,
    0.62, 0.45, 0.14, 0.08, 0.02, 0.02, 0.02, 0.01,
    0.73, 0.22, 0.14, 0.05, 0.02, 0.02, 0.00,
    0.33, 0.19, 0.04, 0.03, 0.02, 0.02,
    0.58, 0.37, 0.27, 0.20, 0.23,
    0.74, 0.50, 0.41, 0.28,
    0.76, 0.62, 0.55,
    0.85, 0.68,
    0.76,
]


def xyz(nm):
    rows = {int(r[0]): r[1:] for r in np.loadtxt(CMF, delimiter=',')}
    return np.array([rows[w] for w in nm])


def swatch(XYZ, size=28):
    """The wavelength as a disc of (approximately) its colour. Spectral lights lie
    outside sRGB, so each is mixed with just enough grey to fit, then brightened."""
    M = np.array([[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]])
    rgb = M @ (XYZ / XYZ[1])
    grey = rgb.mean()
    if rgb.min() < 0:
        t = -rgb.min() / (grey - rgb.min())
        rgb = rgb + t * (grey - rgb)
    rgb = rgb / rgb.max()
    srgb = np.where(rgb <= 0.0031308, 12.92 * rgb, 1.055 * rgb ** (1 / 2.4) - 0.055)
    ss = 4
    im = Image.new('RGBA', (size * ss, size * ss), (0, 0, 0, 0))
    ImageDraw.Draw(im).ellipse((ss, ss, (size - 1) * ss, (size - 1) * ss),
                               fill=tuple(int(round(c * 255)) for c in srgb) + (255,))
    buf = io.BytesIO()
    im.resize((size, size), Image.LANCZOS).save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def load():
    D = 1 - squareform(np.array(SIM))
    np.fill_diagonal(D, 0)
    XYZ = xyz(NM)
    X, Y, Z = XYZ.T
    uv = np.column_stack([4 * X, 9 * Y]) / (X + 15 * Y + 3 * Z)[:, None]   # CIE 1976 u′, v′
    return {
        'title': 'Ekman’s colours',
        'blurb': 'Fourteen spectral colours, 434–674 nm. One view is how alike 31 people '
                 'rated every pair; the other is where each light sits on the CIE chromaticity chart.',
        'labels': [f'{w} nm' for w in NM],
        'thumbs': [swatch(c) for c in XYZ],
        'thumbs_color': True,
        'reading': {'ph': ['ekman', 'shepard_1962'], 'rsa': ['ekman']},
        'metric_note': 'Here: as judged, 1 − Ekman’s mean similarity rating (0–4, divided by 4); '
                       'as light, straight-line distance on the CIE 1976 u′v′ chart.',
        'views': [
            {'name': 'as judged', 'D': D},
            {'name': 'as light', 'X': uv, 'metric': 'euclidean'},
        ],
    }
