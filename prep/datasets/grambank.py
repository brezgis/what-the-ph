"""Grambank v1.0.3: ~300 languages, where they are spoken vs how their grammar works.

Raw data: prep/raw/grambank/{languages,values,codes}.csv, the CLDF tables from
https://github.com/grambank/grambank/archive/refs/tags/v1.0.3.zip (CC BY 4.0).
"""

import csv
from collections import Counter, defaultdict

import numpy as np

from ._common import RAW

G = RAW / 'grambank'
N = 300
MIN_KNOWN = 150          # of 195 features coded (not '?'), i.e. at most ~23% missing
FAMILY_CAP = 8           # no family may crowd out the rest (Austronesian alone has 1,000+)
MACRO = ['Eurasia', 'Africa', 'Papunesia', 'Australia', 'North America', 'South America']
QUOTA = {'Eurasia': 60, 'Africa': 55, 'Papunesia': 58, 'Australia': 35,
         'North America': 50, 'South America': 45}
# always in, if Grambank has them (Spanish, German, Pirahã and Yoruba are not in v1.0.3)
FAMOUS = ['stan1293', 'mand1415', 'russ1263', 'hind1269', 'stan1318', 'swah1253', 'nucl1643',
          'nucl1301', 'finn1318', 'basq1248', 'nava1243', 'cusc1236', 'hawa1245', 'kore1280',
          'hebr1245', 'nucl1302', 'hung1274', 'ainu1240', 'buru1296', 'tami1289', 'stan1290',
          'iris1253', 'wels1247', 'maor1246', 'kala1399', 'chuk1273', 'kett1243', 'cher1273',
          'clas1250', 'samo1305', 'west2369', 'port1283', 'ital1282', 'dutc1256', 'poli1260',
          'yuec1235', 'viet1252', 'dyir1250', 'warl1254']


def unit(lat, lon):
    la, lo = np.radians(lat), np.radians(lon)
    return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], -1)


def _select(langs, known):
    """Famous languages first, then greedy farthest-point sampling on the globe
    within each macroarea (a mild bonus for fewer missing values), never more
    than FAMILY_CAP from one family."""
    fam = lambda g: langs[g]['Family_name'] or f'isolate:{g}'
    cand = [g for g, r in langs.items() if r['level'] == 'language' and r['Macroarea'] in QUOTA
            and r['Latitude'] and known[g] >= MIN_KNOWN]
    chosen = [g for g in FAMOUS if g in cand]
    per_fam = Counter(fam(g) for g in chosen)
    per_mac = Counter(langs[g]['Macroarea'] for g in chosen)
    P = {g: unit(float(langs[g]['Latitude']), float(langs[g]['Longitude'])) for g in cand}
    for mac in MACRO:
        pool = sorted(g for g in cand if langs[g]['Macroarea'] == mac and g not in chosen)
        mine = [g for g in chosen if langs[g]['Macroarea'] == mac]
        while per_mac[mac] < QUOTA[mac]:
            best, score = None, -1
            for g in pool:
                if per_fam[fam(g)] >= FAMILY_CAP:
                    continue
                d = min((np.arccos(np.clip(P[g] @ P[h], -1, 1)) for h in mine), default=np.pi)
                s = d * (known[g] / 195) ** 2
                if s > score:
                    best, score = g, s
            if best is None:
                break
            pool.remove(best)
            mine.append(best)
            chosen.append(best)
            per_fam[fam(best)] += 1
            per_mac[mac] += 1
    # stable, readable order: by macroarea, then family, then name
    return sorted(chosen, key=lambda g: (MACRO.index(langs[g]['Macroarea']), fam(g), langs[g]['Name']))


def load():
    langs = {r['ID']: r for r in csv.DictReader(open(G / 'languages.csv', encoding='utf-8'))}
    codes = defaultdict(list)                      # parameter -> its possible values, in order
    for r in csv.DictReader(open(G / 'codes.csv', encoding='utf-8')):
        codes[r['Parameter_ID']].append(r['Name'])
    vals = defaultdict(dict)
    known = Counter()
    for r in csv.DictReader(open(G / 'values.csv', encoding='utf-8')):
        if r['Value'] not in ('?', ''):
            vals[r['Language_ID']][r['Parameter_ID']] = r['Value']
            known[r['Language_ID']] += 1

    ids = _select(langs, known)
    params = sorted(codes)
    cols = [(p, v) for p in params for v in codes[p]]
    col = {c: j for j, c in enumerate(cols)}
    B = np.zeros((len(ids), len(cols)), np.float32)
    for i, g in enumerate(ids):
        for p, v in vals[g].items():
            B[i, col[(p, v)]] = 1                 # unknown feature: its whole block stays 0
    A = np.stack([unit(float(langs[g]['Latitude']), float(langs[g]['Longitude'])) for g in ids])

    fam = [langs[g]['Family_name'] or 'isolate' for g in ids]
    return {
        'title': 'Grambank: where vs how',
        'blurb': f'{len(ids)} languages from every inhabited continent. One view is simply '
                 'where each is spoken, a dot on the globe. The other is its grammar: '
                 f'{len(params)} yes/no questions like “are there definite articles?” or '
                 '“can the verb come first?”. Do neighbours on the map talk alike?',
        'labels': [langs[g]['Name'] for g in ids],
        'subs': [f'{f} · {langs[g]["Macroarea"]} · {known[g]}/{len(params)} features known'
                 for g, f in zip(ids, fam)],
        'groups': [MACRO.index(langs[g]['Macroarea']) for g in ids],
        'group_names': MACRO,
        'notes': {
            'neighbors': 'Grammar keeps family close: Navajo’s nearest grammars are Sarsi, Chipewyan '
                         'and the Slaveys, all Athabaskan; Hawaiian’s are Maori and Samoan. But English’s '
                         'are Dutch, then Estonian and Finnish: Uralic, not Indo-European, yet next door.',
        },
        'cite': ['grambank', 'glottolog'],
        'h2': True,
        'views': [
            # cosine on unit vectors = 1 − cos(angle): same order as great-circle distance
            {'name': 'where it’s spoken', 'X': A, 'metric': 'cosine'},
            # cosine on one-hot blocks = (# features answered the same) / √(known_a · known_b):
            # a feature unknown in either language counts neither for nor against
            {'name': 'grammar', 'X': B, 'metric': 'cosine'},
        ],
    }
