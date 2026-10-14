"""World cities: where they are on the globe vs. what their weather is like.

Cities come from GeoNames cities15000 (CC BY 4.0); the climate is NASA POWER's
monthly climatology at each city's coordinates. POWER answers are cached under
raw/cities/power/<geonameid>.json, so only the first run talks to the API.
"""

import json
import math
import time
import urllib.request
import zipfile

import numpy as np

from ._common import RAW

DIR = RAW / 'cities'
POWER = ('https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,PRECTOTCORR'
         '&community=AG&longitude={lon}&latitude={lat}&format=JSON')
MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

N_BIG = 200          # the most populous cities, at most CAP(country) per country
CAPITAL_MIN = 4e6    # plus the capital of every country with at least this many people
# plus places that keep the globe covered: the far north and south, oceans, islands
EXTRAS = [
    ('Reykjavík', 'IS'), ('Nuuk', 'GL'), ('Tórshavn', 'FO'), ('Longyearbyen', 'SJ'), ('Tromsø', 'NO'),
    ('Murmansk', 'RU'), ('Vorkuta', 'RU'), ('Norilsk', 'RU'), ('Yakutsk', 'RU'), ('Magadan', 'RU'),
    ('Petropavlovsk-Kamchatsky', 'RU'), ('Anchorage', 'US'), ('Fairbanks', 'US'), ('Whitehorse', 'CA'),
    ('Yellowknife', 'CA'), ('Honolulu', 'US'), ('Ushuaia', 'AR'), ('Punta Arenas', 'CL'), ('Stanley', 'FK'),
    ('Hobart', 'AU'), ('Darwin', 'AU'), ('Perth', 'AU'), ('Christchurch', 'NZ'), ('Suva', 'FJ'),
    ('Papeete', 'PF'), ('Nouméa', 'NC'), ('Apia', 'WS'), ('Port Moresby', 'PG'), ('Honiara', 'SB'),
    ('Port-Vila', 'VU'), ('Nuku‘alofa', 'TO'), ('Majuro', 'MH'), ('Tarawa', 'KI'), ('Funafuti', 'TV'),
    ('Avarua', 'CK'), ('Pago Pago', 'AS'), ('Hagåtña', 'GU'), ('Adamstown', 'PN'), ('Jamestown', 'SH'),
    ('Port-aux-Français', 'TF'), ('Port Louis', 'MU'), ('Saint-Denis', 'RE'), ('Antananarivo', 'MG'),
    ('Victoria', 'SC'), ('Male', 'MV'), ('Praia', 'CV'), ('Funchal', 'PT'), ('Ponta Delgada', 'PT'),
    ('Las Palmas de Gran Canaria', 'ES'), ('Lhasa', 'CN'), ('Ulan Bator', 'MN'), ('La Paz', 'BO'),
    ('Quito', 'EC'), ('Cusco', 'PE'), ('Manaus', 'BR'), ('Timbuktu', 'ML'), ('Windhoek', 'NA'),
    ('Cape Town', 'ZA'), ('Dubai', 'AE'), ('Singapore', 'SG'), ('Kathmandu', 'NP'), ('Wellington', 'NZ'),
    ('Kolkata', 'IN'), ('Boston', 'US'), ('San Francisco', 'US'), ('Seattle', 'US'), ('Denver', 'US'),
    ('Miami', 'US'), ('Vancouver', 'CA'), ('Marrakesh', 'MA'), ('Edinburgh', 'GB'),
]
# boroughs and suburbs that GeoNames counts as their own cities
SKIP = {'Brooklyn', 'Queens', 'Iztapalapa', 'Abobo', 'Caloocan', 'Quezon City', 'Giza',
        'Shubrā al Khaymah', 'Khartoum North', 'Gazipur', 'Bekasi', 'Kakamega', 'Callao',
        'Matola', 'New Taipei City'}
CONTINENTS = {'AF': 'Africa', 'AS': 'Asia', 'EU': 'Europe', 'NA': 'North America',
              'SA': 'South America', 'OC': 'Oceania', 'AN': 'Antarctica'}
GROUPS = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Antarctica']
# a few GeoNames names that read oddly in a tooltip
RENAME = {'Ulan Bator': 'Ulaanbaatar', 'Male': 'Malé', 'New York City': 'New York',
          'Mexico City': 'Mexico City', 'Port-aux-Français': 'Port-aux-Français (Kerguelen)'}


def cap(country_pop):
    """Most cities any one country gets among the big ones: ~1 per doubling over 10 M."""
    return max(1, min(6, int(math.log2(max(country_pop, 1) / 10e6)) + 1))


def countries():
    out = {}
    for line in open(DIR / 'countryInfo.txt', encoding='utf-8'):
        if line.startswith('#'):
            continue
        f = line.rstrip('\n').split('\t')
        out[f[0]] = {'name': f[4], 'pop': int(f[7] or 0), 'cont': f[8]}
    return out


def read_cities():
    with zipfile.ZipFile(DIR / 'cities15000.zip') as z:
        text = z.read('cities15000.txt').decode('utf-8')
    rows = []
    for line in text.splitlines():
        f = line.split('\t')
        rows.append({'id': f[0], 'name': f[1], 'lat': float(f[4]), 'lon': float(f[5]),
                     'code': f[7], 'cc': f[8], 'pop': int(f[14] or 0)})
    return rows


def select():
    C = countries()
    rows = [r for r in read_cities() if r['code'] not in ('PPLX', 'PPLH') and r['name'] not in SKIP]  # no boroughs, no ruins
    rows.sort(key=lambda r: -r['pop'])
    chosen, seen, per = [], set(), {}

    def add(r):
        if r['id'] not in seen:
            seen.add(r['id'])
            chosen.append(r)

    for r in rows:
        if len(chosen) >= N_BIG:
            break
        if per.get(r['cc'], 0) < cap(C[r['cc']]['pop']):
            per[r['cc']] = per.get(r['cc'], 0) + 1
            add(r)
    for r in rows:
        if r['code'] == 'PPLC' and C[r['cc']]['pop'] >= CAPITAL_MIN:
            add(r)
    by_name = {}
    for r in rows:
        by_name.setdefault((r['name'], r['cc']), r)   # most populous of that name
    for key in EXTRAS:
        if key not in by_name:
            raise SystemExit(f'cities: no GeoNames row for {key}')
        add(by_name[key])
    return chosen, C


def flag(cc):
    return ''.join(chr(0x1F1E6 + ord(c) - ord('A')) for c in cc.upper())


def power(r):
    """Monthly T2M (°C) and PRECTOTCORR (mm/day) for one city, cached on disk."""
    path = DIR / 'power' / f"{r['id']}.json"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        url = POWER.format(lon=round(r['lon'], 4), lat=round(r['lat'], 4))
        for attempt in range(6):
            try:
                with urllib.request.urlopen(url, timeout=60) as resp:
                    body = resp.read()
                json.loads(body)['properties']['parameter']['T2M']   # sanity
                path.write_bytes(body)
                break
            except Exception as e:  # noqa: BLE001 — retry anything, then give up loudly
                print(f'  POWER {r["name"]}: {e}; retry {attempt + 1}')
                time.sleep(5 * (attempt + 1))
        else:
            raise SystemExit(f'cities: POWER failed for {r["name"]}')
        time.sleep(1.0)   # be polite
    p = json.loads(path.read_text())['properties']['parameter']
    return [p['T2M'][m] for m in MONTHS], [p['PRECTOTCORR'][m] for m in MONTHS]


def load():
    chosen, C = select()
    T, P = [], []
    for r in chosen:
        t, p = power(r)
        T.append(t)
        P.append(p)
    T, P = np.array(T, float), np.array(P, float)
    clim = np.hstack([T, np.log1p(np.maximum(P, 0))])
    clim = (clim - clim.mean(0)) / clim.std(0)
    lat, lon = np.radians([r['lat'] for r in chosen]), np.radians([r['lon'] for r in chosen])
    where = np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], 1)

    def fmt_pop(n):
        return f'{n / 1e6:.1f} M people' if n >= 1e6 else f'{n:,} people'

    labels = [f"{RENAME.get(r['name'], r['name'])} {flag(r['cc'])}" for r in chosen]
    subs = [f"{C[r['cc']]['name']} · {fmt_pop(r['pop'])} · {T[i].min():.0f}…{T[i].max():.0f} °C, "
            f"{P[i].sum() * 30.4:.0f} mm/yr" for i, r in enumerate(chosen)]
    groups = [GROUPS.index(CONTINENTS[C[r['cc']]['cont']]) for r in chosen]   # GeoNames' continent
    return {
        'title': 'World cities',
        'blurb': f'{len(chosen)} cities on every continent and plenty of islands. One view is '
                 'where they sit on the globe (a sphere). The other is their climate: '
                 'twelve monthly temperatures and twelve monthly rainfalls. Cities far apart '
                 'can share a climate; neighbors across a mountain range may not.',
        'labels': labels,
        'subs': subs,
        'groups': groups,
        'group_names': GROUPS,
        'cite': ['geonames', 'nasa_power'],
        'h2': True,
        'views': [
            {'name': 'on the globe', 'X': where, 'metric': 'euclidean'},
            {'name': 'climate', 'X': clim, 'metric': 'euclidean'},
        ],
    }
