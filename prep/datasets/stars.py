"""Named stars: where they really are in space vs. where we see them on the sky.

HYG v4.1 (astronexus, CC BY-SA 4.0), every star with an IAU-style proper name
except the Sun and the few whose distance HYG doesn't know (it writes 100 000 pc
for those), keeping the 450 brightest.
"""

import base64
import csv
import io

import numpy as np
from PIL import Image

from ._common import RAW

CSV = RAW / 'stars' / 'hygdata_v41.csv'
N_MAX = 450
PC_TO_LY = 3.261564

CONSTELLATIONS = {
    'And': 'Andromeda', 'Ant': 'Antlia', 'Aps': 'Apus', 'Aqr': 'Aquarius', 'Aql': 'Aquila', 'Ara': 'Ara',
    'Ari': 'Aries', 'Aur': 'Auriga', 'Boo': 'Boötes', 'Cae': 'Caelum', 'Cam': 'Camelopardalis',
    'Cnc': 'Cancer', 'CVn': 'Canes Venatici', 'CMa': 'Canis Major', 'CMi': 'Canis Minor',
    'Cap': 'Capricornus', 'Car': 'Carina', 'Cas': 'Cassiopeia', 'Cen': 'Centaurus', 'Cep': 'Cepheus',
    'Cet': 'Cetus', 'Cha': 'Chamaeleon', 'Cir': 'Circinus', 'Col': 'Columba', 'Com': 'Coma Berenices',
    'CrA': 'Corona Australis', 'CrB': 'Corona Borealis', 'Crv': 'Corvus', 'Crt': 'Crater', 'Cru': 'Crux',
    'Cyg': 'Cygnus', 'Del': 'Delphinus', 'Dor': 'Dorado', 'Dra': 'Draco', 'Equ': 'Equuleus',
    'Eri': 'Eridanus', 'For': 'Fornax', 'Gem': 'Gemini', 'Gru': 'Grus', 'Her': 'Hercules',
    'Hor': 'Horologium', 'Hya': 'Hydra', 'Hyi': 'Hydrus', 'Ind': 'Indus', 'Lac': 'Lacerta', 'Leo': 'Leo',
    'LMi': 'Leo Minor', 'Lep': 'Lepus', 'Lib': 'Libra', 'Lup': 'Lupus', 'Lyn': 'Lynx', 'Lyr': 'Lyra',
    'Men': 'Mensa', 'Mic': 'Microscopium', 'Mon': 'Monoceros', 'Mus': 'Musca', 'Nor': 'Norma',
    'Oct': 'Octans', 'Oph': 'Ophiuchus', 'Ori': 'Orion', 'Pav': 'Pavo', 'Peg': 'Pegasus', 'Per': 'Perseus',
    'Phe': 'Phoenix', 'Pic': 'Pictor', 'Psc': 'Pisces', 'PsA': 'Piscis Austrinus', 'Pup': 'Puppis',
    'Pyx': 'Pyxis', 'Ret': 'Reticulum', 'Sge': 'Sagitta', 'Sgr': 'Sagittarius', 'Sco': 'Scorpius',
    'Scl': 'Sculptor', 'Sct': 'Scutum', 'Ser': 'Serpens', 'Sex': 'Sextans', 'Tau': 'Taurus',
    'Tel': 'Telescopium', 'Tri': 'Triangulum', 'TrA': 'Triangulum Australe', 'Tuc': 'Tucana',
    'UMa': 'Ursa Major', 'UMi': 'Ursa Minor', 'Vel': 'Vela', 'Vir': 'Virgo', 'Vol': 'Volans',
    'Vul': 'Vulpecula',
}
CLASSES = 'OBAFGKM'
GROUP_NAMES = ['O/B (blue-white)', 'A (white)', 'F (yellow-white)', 'G (yellow, like the Sun)',
               'K (orange)', 'M (red)', 'other']


def spectral_group(spect):
    s = spect.strip().lstrip('sdg')   # subdwarf/dwarf/giant prefixes; white dwarfs (D…) fall to 'other'
    c = s[:1].upper()
    if c in 'OB' and c:
        return 0
    return {'A': 1, 'F': 2, 'G': 3, 'K': 4, 'M': 5}.get(c, 6)


def bv_to_rgb(bv):
    """B−V colour index → sRGB, via an effective temperature (Ballesteros 2012) and
    Tanner Helland's blackbody-to-RGB fit."""
    bv = min(max(bv, -0.4), 2.0)
    t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62)) / 100
    if t <= 66:
        r = 255
        g = 99.4708025861 * np.log(t) - 161.1195681661
        b = 0 if t <= 19 else 138.5177312231 * np.log(t - 10) - 305.0447927307
    else:
        r = 329.698727446 * (t - 60) ** -0.1332047592
        g = 288.1221695283 * (t - 60) ** -0.0755148492
        b = 255
    return tuple(int(min(255, max(0, v))) for v in (r, g, b))


def glow(rgb, mag, size=32):
    """A soft dot on transparent background: colour from B−V, size from brightness."""
    # brightest (mag ≈ −1.5) → wide glow; faint (mag ≥ 8) → small spark
    k = float(np.clip((8 - mag) / 9.5, 0, 1))
    sigma = size * (0.06 + 0.16 * k)
    yy, xx = np.mgrid[:size, :size] - (size - 1) / 2
    rr = np.hypot(xx, yy)
    a = np.exp(-(rr / sigma) ** 2) + 0.35 * np.exp(-rr / (sigma * 1.6))
    a = np.clip(a / a.max(), 0, 1)
    core = np.exp(-(rr / (sigma * 0.45)) ** 2)   # white-hot centre
    rgb = np.array(rgb, float)
    col = rgb[None, None] * (1 - core[..., None]) + 255 * core[..., None]
    img = np.dstack([col, a[..., None] * 255]).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(img, 'RGBA').quantize(48, method=Image.Quantize.FASTOCTREE).save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def rows():
    out = []
    for r in csv.DictReader(open(CSV, encoding='utf-8')):
        if not r['proper'] or r['proper'] == 'Sol' or float(r['dist']) >= 100000:
            continue
        out.append(r)
    out.sort(key=lambda r: float(r['mag']))
    return out[:N_MAX]


def load():
    R = rows()
    xyz = np.array([[float(r['x']), float(r['y']), float(r['z'])] for r in R])
    r_pc = np.linalg.norm(xyz, axis=1)
    where = xyz / r_pc[:, None] * np.log10(1 + r_pc * PC_TO_LY)[:, None]
    ra, dec = np.array([float(r['rarad']) for r in R]), np.array([float(r['decrad']) for r in R])
    sky = np.stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)], 1)

    def ly(d):
        x = d * PC_TO_LY
        return f'{x:.1f} ly' if x < 10 else f'{x:,.0f} ly'

    subs = [f"{CONSTELLATIONS.get(r['con'], r['con'] or '?')} · {ly(float(r['dist']))} · mag {round(float(r['mag']), 1) + 0:.1f}"
            for r in R]
    thumbs = [glow(bv_to_rgb(float(r['ci']) if r['ci'] else 0.6), float(r['mag'])) for r in R]
    return {
        'title': 'Named stars',
        'blurb': f'The {len(R)} brightest stars that have a proper name. One view is where each '
                 'star really is in 3-D space around the Sun; the other is just where it '
                 'appears on the sky, a perfect sphere. Neighbors on the sky can be '
                 'hundreds of light-years apart.',
        'labels': [r['proper'] for r in R],
        'subs': subs,
        'groups': [spectral_group(r['spect']) for r in R],
        'group_names': GROUP_NAMES,
        'thumbs': thumbs,
        'thumbs_color': True,
        'cite': ['hyg'],
        'h2': True,
        'views': [
            {'name': 'in space (log distance)', 'X': where, 'metric': 'euclidean'},
            {'name': 'on the sky', 'X': sky, 'metric': 'euclidean'},
        ],
    }
