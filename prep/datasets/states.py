"""Shapes of states: Shepard & Chipman (1970), name condition vs. picture condition.

Seven Harvard graduate students rank-ordered all 105 pairs of 15 U.S. states by
how similar their shapes are, once from the printed names alone and then from
outline drawings. The paper never prints the averaged rank matrices; what it
does print is Fig. 1: the two 2-D nonmetric MDS solutions (Kruskal's M-D-SCAL)
superimposed after Cliff's rotation to congruence, as arrows whose tail is the
picture-condition point and whose head is the name-condition point.

So the two views here are those 2-D configurations, digitized from the 300-dpi
scan of Fig. 1 (p. 12): each tail is the centre of its small ring (fitted with a
ring template, all 15 found exactly), each head is the tip of its arrow (found
by walking along the shaft). Units are pixels of that scan, y pointing down; the
build rescales, so only the shape of the configuration matters. Since an MDS
solution is only defined up to rotation, reflection and scale, Euclidean
distance is the only one that means anything here.

Thumbnails are filled silhouettes from the Census Bureau's 2023 cartographic
boundary file (1:5,000,000, public domain), drawn north-up in an Albers
equal-area projection, close to the conventional U.S. map the outlines were
traced from.
"""

import base64
import io
import re
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image, ImageDraw

from ._common import RAW

KML = RAW / 'states' / 'cb' / 'cb_2023_us_state_5m.kml'

# state: (picture = arrow tail, name = arrow head), Fig. 1 pixels
FIG1 = {
    'Alabama':        ((317, 387), (394, 227)),
    'Colorado':       ((584, 112), (640, 167)),
    'Florida':        ((1022, 829), (1048, 862)),
    'Idaho':          ((898, 502), (777, 478)),
    'Illinois':       ((256, 569), (244, 581)),
    'Louisiana':      ((650, 868), (833, 932)),
    'Maine':          ((207, 919), (118, 785)),
    'Minnesota':      ((458, 254), (225, 350)),
    'Missouri':       ((528, 371), (376, 351)),
    'Nebraska':       ((733, 358), (683, 248)),
    'Nevada':         ((150, 364), (550, 422)),
    'Oklahoma':       ((875, 406), (898, 373)),
    'Oregon':         ((598, 185), (600, 91)),
    'South Carolina': ((247, 1052), (209, 1130)),
    'West Virginia':  ((423, 1041), (370, 1195)),
}

# the four kinds of shape the authors read off Fig. 1 (pp. 12–13). Their groups
# overlap (Nebraska and Oklahoma are also rectangular; Louisiana and Florida also
# have a handle), so each state goes where Fig. 2 draws it most squarely.
GROUP_NAMES = ['horizontal & rectangular', 'with a bend or handle',
               'vertical & irregular', 'smallish & wiggly']
GROUP = {'Colorado': 0, 'Oregon': 0, 'Nebraska': 1, 'Oklahoma': 1, 'Idaho': 1,
         'Alabama': 2, 'Illinois': 2, 'Minnesota': 2, 'Missouri': 2, 'Nevada': 2,
         'Maine': 3, 'South Carolina': 3, 'West Virginia': 3, 'Louisiana': 3, 'Florida': 3}


def outlines():
    """{state name: [rings of (lon, lat)]} from the Census KML."""
    ns = {'k': 'http://www.opengis.net/kml/2.2'}
    out = {}
    for pm in ET.parse(KML).getroot().iter('{http://www.opengis.net/kml/2.2}Placemark'):
        name = pm.find('.//k:SimpleData[@name="NAME"]', ns).text
        if name not in FIG1:
            continue
        out[name] = [np.array([[float(v) for v in p.split(',')[:2]] for p in re.split(r'\s+', c.text.strip())])
                     for c in pm.iterfind('.//k:outerBoundaryIs//k:coordinates', ns)]
    return out


def albers(lonlat, lat1=29.5, lat2=45.5, lat0=23.0, lon0=-96.0):
    """Albers equal-area conic, the usual projection for maps of the lower 48."""
    p1, p2, p0 = np.radians([lat1, lat2, lat0])
    n = (np.sin(p1) + np.sin(p2)) / 2
    C = np.cos(p1) ** 2 + 2 * n * np.sin(p1)
    rho = lambda p: np.sqrt(C - 2 * n * np.sin(p)) / n
    lam, phi = np.radians(lonlat[:, 0] - lon0), np.radians(lonlat[:, 1])
    r, th = rho(phi), n * lam
    return np.column_stack([r * np.sin(th), rho(p0) - r * np.cos(th)])


def silhouette(rings, size=56, pad=2):
    """Filled outline, north up, longer side = size. Grayscale, bright = ink."""
    xy = [albers(r) for r in rings]
    allp = np.vstack(xy)
    lo, hi = allp.min(0), allp.max(0)
    k = (size - 2 * pad) / (hi - lo).max()
    w, h = np.ceil((hi - lo) * k).astype(int) + 2 * pad
    ss = 4   # draw large, then shrink: smooth edges
    im = Image.new('L', (w * ss, h * ss), 0)
    d = ImageDraw.Draw(im)
    for p in xy:
        q = (p - lo) * k + pad
        q[:, 1] = h - q[:, 1]       # y grows downwards in images
        d.polygon([tuple(v) for v in q * ss], fill=255)
    im = im.resize((w, h), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def load():
    states = sorted(FIG1)
    shapes = outlines()
    flip = np.array([1, -1])   # figure pixels have y down; keep the paper's picture upright
    A = np.array([FIG1[s][1] for s in states], float) * flip   # name condition
    B = np.array([FIG1[s][0] for s in states], float) * flip   # picture condition
    return {
        'title': 'Shapes of states',
        'blurb': 'Shepard & Chipman’s 15 U.S. states, placed by how alike people judged '
                 'their shapes: once from the names alone, once from outline drawings. '
                 'Both maps are the 2-D solutions printed in their Fig. 1.',
        'labels': states,
        'groups': [GROUP[s] for s in states],
        'group_names': GROUP_NAMES,
        'thumbs': [silhouette(shapes[s]) for s in states],
        'notes': {
            'procrustes': 'Oregon and Colorado were judged the most alike under both conditions; '
                          'Nevada moves furthest when its shape has to be imagined.',
        },
        'reading': {'rsa': ['shepard_chipman'], 'procrustes': ['shepard_chipman', 'cliff_rotation']},
        'metrics': ['euclidean'],
        'views': [
            {'name': 'from the name', 'X': A, 'metric': 'euclidean'},
            {'name': 'from the outline', 'X': B, 'metric': 'euclidean'},
        ],
    }
