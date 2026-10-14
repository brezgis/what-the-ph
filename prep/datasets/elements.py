"""The chemical elements H … Cm: measured properties vs. place on the table.

View B is the familiar 18-column periodic table, with the f-block as two rows
underneath (a half-row gap above them), instead of the 32-column long form.
Lu sits under Y and Sc (as IUPAC's 2021 group-3 report has it). A
cell is one unit wide and one unit tall. (A valence-occupancy view — ns, np,
(n-1)d, (n-2)f electron counts — was tried too: it stacks whole groups on one
point and the f count swamps the rest; RSA with the properties fell to 0.18 vs
0.44 here.)"""

import base64
import csv
import io

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from ._common import RAW

ZMAX = 96   # Curium: the last element with (nearly) every property measured
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

# Pauling values do not exist for the light noble gases (or radon); Allen's
# spectroscopic scale does, and agrees with Pauling where both exist (Kr 3.00/2.97,
# Xe 2.60/2.58). Allen, J. Am. Chem. Soc. 111 (1989) 9003.
ALLEN = {'He': 4.16, 'Ne': 4.79, 'Ar': 3.24, 'Rn': 2.60}
CPK_FALLBACK = {'Er': '00E675'}   # Jmol's colour; PubChem leaves it blank

PROPS = ['Electronegativity', 'AtomicRadius', 'IonizationEnergy', 'ElectronAffinity',
         'MeltingPoint', 'BoilingPoint', 'Density']
LOGGED = {'MeltingPoint', 'BoilingPoint', 'Density'}
PERIOD_START = [1, 3, 11, 19, 37, 55, 87]


def _f(s):
    return float(s) if s.strip() else np.nan


def _period(z):
    return sum(z >= s for s in PERIOD_START)


def _place(z, period):
    """(row, column) on the familiar 18-column table. La–Yb and Ac–No sit in
    their own two rows underneath, with a half-row gap, as printed tables do."""
    o = z - PERIOD_START[period - 1]
    if period == 1:
        return 1, (1 if z == 1 else 18)       # helium over the noble gases
    if period <= 3:
        return period, (o + 1 if o < 2 else o + 11)
    if period <= 5:
        return period, o + 1
    if o < 2:
        return period, o + 1                  # Cs Ba / Fr Ra
    if o <= 15:
        return period + 2.5, o + 1            # the f-block rows, columns 3–16
    return period, o - 13                     # Lu/Lr under Y, then Hf… across


def _place_all(Z, periods):
    # (column, −row): same distances, and drawn as-is it reads like the printed table
    return [[c, -r] for r, c in (_place(z, p) for z, p in zip(Z, periods))]


def _tile(sym, hexcol, size=40, ss=4):
    """Rounded tile in the element's CPK colour with its symbol."""
    hexcol = hexcol.zfill(6)                          # PubChem drops leading zeros (Pd: 6985)
    rgb = tuple(int(hexcol[k:k + 2], 16) for k in (0, 2, 4))
    lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    ink = (20, 20, 24) if lum > 140 else (250, 250, 250)
    edge = tuple(round(c * 0.72) for c in rgb)       # a darker rim, so white H still shows
    S = size * ss
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([ss, ss, S - 1 - ss, S - 1 - ss], radius=8 * ss, fill=rgb + (255,),
                        outline=edge + (255,), width=2 * ss)
    font = ImageFont.truetype(FONT, (19 if len(sym) == 1 else 17) * ss)
    d.text((S / 2, S / 2 + ss), sym, font=font, fill=ink + (255,), anchor='mm')
    im = im.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def load():
    rows = [r for r in csv.DictReader(open(RAW / 'elements' / 'periodictable.csv', encoding='utf-8'))
            if int(r['AtomicNumber']) <= ZMAX]
    Z = np.array([int(r['AtomicNumber']) for r in rows])
    P = np.array([[_f(r[c]) for c in PROPS] for r in rows])
    syms = [r['Symbol'] for r in rows]

    en, ea = PROPS.index('Electronegativity'), PROPS.index('ElectronAffinity')
    for k, s in enumerate(syms):
        if s in ALLEN:
            P[k, en] = ALLEN[s]
    P[np.isnan(P[:, ea]), ea] = 0.0        # blank = no stable anion (or none measured)
    for c in LOGGED:
        P[:, PROPS.index(c)] = np.log10(P[:, PROPS.index(c)])
    # what is still missing (EN of Pm, Eu, Tb, Yb; boiling point of At, Fr, Pa;
    # density of Fr) comes from the five elements most alike on what is known
    from sklearn.impute import KNNImputer
    mu, sd = np.nanmean(P, 0), np.nanstd(P, 0)
    A = KNNImputer(n_neighbors=5).fit_transform((P - mu) / sd)
    A = (A - A.mean(0)) / A.std(0)

    periods = [_period(z) for z in Z]
    B = np.array(_place_all(Z, periods), float)

    blocks = []
    for r in rows:
        if r['GroupBlock'] not in blocks:
            blocks.append(r['GroupBlock'])

    return {
        'title': 'Periodic Table of Elements',
        'blurb': f'The first {len(rows)} elements, hydrogen to curium. One view is how they '
                 'behave: electronegativity, size, ionization energy, electron affinity, melting '
                 'and boiling points, density. The other is simply where each one sits on the '
                 '18-column periodic table (f-block rows underneath).',
        'labels': [f'{r["Symbol"]} · {r["Name"]}' for r in rows],
        'subs': [f'{r["GroupBlock"]} · Z = {r["AtomicNumber"]} · {r["ElectronConfiguration"]}'
                 for r in rows],
        'groups': [blocks.index(r['GroupBlock']) for r in rows],
        'group_names': blocks,
        'thumbs': [_tile(r['Symbol'], r['CPKHexColor'] or CPK_FALLBACK[r['Symbol']]) for r in rows],
        'thumbs_color': True,
        'notes': {
            'neighbors': 'Columns keep their friends: francium’s nearest neighbors on properties '
                         'alone are caesium, rubidium and potassium, astatine’s are iodine, tellurium '
                         'and selenium. Periods do not: the table puts iron next to cobalt, and so do '
                         'the properties, but carbon’s property neighbors are iridium, rhodium and nickel.',
        },
        'cite': ['pubchem_ptable'],
        'views': [
            {'name': 'properties', 'X': A, 'metric': 'euclidean'},
            {'name': 'place on the table', 'X': B, 'metric': 'euclidean'},
        ],
    }
