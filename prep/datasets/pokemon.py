"""Pokémon of Generations I–III: battle stats vs. what the sprite looks like."""

import base64
import csv
import io

import numpy as np
from PIL import Image

from ._common import RAW
from ._vision import dino

DIR = RAW / 'pokemon'
N = 386                       # Bulbasaur … Deoxys
STATS = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed']


def _rows(name):
    return list(csv.DictReader(open(DIR / f'{name}.csv', encoding='utf-8')))


def _sprite(i):
    """The classic front sprite, RGBA, cropped to its opaque pixels."""
    im = Image.open(DIR / 'sprites' / f'{i}.png').convert('RGBA')
    box = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    return im.crop(box) if box else im


def _on_white(im, pad=0.12):
    """Square, white background, a little margin: what the model sees."""
    s = round(max(im.size) * (1 + 2 * pad))
    bg = Image.new('RGB', (s, s), 'white')
    bg.paste(im, ((s - im.width) // 2, (s - im.height) // 2), im)
    return bg


def _thumb_rgba(im, size):
    w, h = im.size
    k = size / max(w, h)
    small = im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    small = small.quantize(64, method=Image.FASTOCTREE)   # palette + alpha: ~3.5× smaller
    buf = io.BytesIO()
    small.save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def load():
    stat_id = {r['identifier']: int(r['id']) for r in _rows('stats')}
    base = {}
    for r in _rows('pokemon_stats'):
        base[(int(r['pokemon_id']), int(r['stat_id']))] = float(r['base_stat'])
    type_name = {int(r['id']): r['identifier'] for r in _rows('types')}
    primary, secondary = {}, {}
    for r in _rows('pokemon_types'):
        (primary if r['slot'] == '1' else secondary)[int(r['pokemon_id'])] = int(r['type_id'])
    names = {int(r['pokemon_species_id']): r['name'] for r in _rows('pokemon_species_names')
             if r['local_language_id'] == '9'}

    ids = list(range(1, N + 1))
    S = np.array([[base[(i, stat_id[s])] for s in STATS] for i in ids])
    A = (S - S.mean(0)) / S.std(0)

    sprites = [_sprite(i) for i in ids]
    B = dino([_on_white(im) for im in sprites])

    used = sorted({primary[i] for i in ids})
    gidx = {t: k for k, t in enumerate(used)}

    def types(i):
        t = type_name[primary[i]].capitalize()
        return t + ('/' + type_name[secondary[i]].capitalize() if i in secondary else '')

    return {
        'title': 'Pokémon, Gen I–III',
        'blurb': 'The first 386 Pokémon, Bulbasaur to Deoxys. One view is how they fight: '
                 'the six base stats. The other is how they look: what a vision model '
                 'sees in the little Game Boy Advance–era sprite.',
        'labels': [names[i] for i in ids],
        'subs': [f'#{i:03d} · {types(i)} · BST {int(S[k].sum())}' for k, i in enumerate(ids)],
        'groups': [gidx[primary[i]] for i in ids],
        'group_names': [type_name[t].capitalize() for t in used],
        'thumbs': [_thumb_rgba(im, 40) for im in sprites],
        'thumbs_color': True,
        'notes': {
            'neighbors': 'Almost nobody keeps their friends. Charizard’s stat twin is Typhlosion '
                         '(identical, stat for stat), but in looks its neighbors are Salamence and Dragonite. '
                         'The rare trio that stays together is Whiscash, Lanturn and Dunsparce: stubby, '
                         'rounded, middling in both worlds.',
        },
        'cite': ['pokeapi', 'pokeapi_sprites', 'dinov2'],
        'views': [
            {'name': 'battle stats', 'X': A, 'metric': 'euclidean'},
            {'name': 'looks', 'X': B, 'metric': 'cosine'},
        ],
    }
