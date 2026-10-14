import unicodedata

import numpy as np

from ._common import RAW
from ._lm import MODEL, states

LAYER = 10
# (group name, test on the unicode name)
GROUPS = [
    ('clocks', lambda n: n.startswith('CLOCK FACE') and 'THIRTY' not in n),
    ('moon', lambda n: 'MOON' in n and 'FACE' not in n and 'VIEWING' not in n),
    ('faces', lambda n: 'FACE' in n and 'CLOCK' not in n and 'MOON' not in n and 'CAT' not in n),
    ('animals', lambda n: n.split()[-1] in {
        'CAT', 'DOG', 'PIG', 'COW', 'HORSE', 'MOUSE', 'RABBIT', 'TIGER', 'BEAR', 'MONKEY',
        'FROG', 'SNAKE', 'WHALE', 'DOLPHIN', 'FISH', 'OCTOPUS', 'SNAIL', 'BUG', 'BEE',
        'TURTLE', 'CHICKEN', 'PENGUIN', 'BIRD', 'ELEPHANT', 'CAMEL', 'SHEEP', 'GOAT',
        'RAT', 'OX', 'LEOPARD', 'CROCODILE', 'DRAGON', 'POODLE', 'KOALA', 'HAMSTER', 'WOLF'}),
    ('food', lambda n: n.split()[-1] in {
        'PIZZA', 'HAMBURGER', 'SPAGHETTI', 'BREAD', 'CAKE', 'COOKIE', 'CHOCOLATE', 'CANDY',
        'LOLLIPOP', 'CUSTARD', 'DOUGHNUT', 'APPLE', 'PEAR', 'BANANA', 'GRAPES', 'MELON',
        'WATERMELON', 'STRAWBERRY', 'CHERRIES', 'PEACH', 'PINEAPPLE', 'TOMATO', 'AUBERGINE',
        'TANGERINE', 'LEMON', 'SUSHI', 'RICE', 'CURRY', 'TEMPURA', 'EGG', 'DANGO', 'ODEN',
        'ROOT', 'POULTRY', 'BONE'}),
    ('weather', lambda n: n.split()[-1] in {
        'SUN', 'CLOUD', 'UMBRELLA', 'SNOWFLAKE', 'SNOWMAN', 'RAINBOW', 'CYCLONE', 'FOGGY',
        'VOLTAGE', 'DROPLET', 'FIRE', 'WAVE'} or n.startswith('SUN ')),
]


def load():
    vecs = {}
    with open(RAW / 'emoji2vec.txt', encoding='utf-8') as f:
        next(f)
        for line in f:
            e, rest = line.rstrip('\n').split(' ', 1)
            if len(e) == 1:
                vecs[e] = np.array(rest.split(), dtype=np.float32)

    chosen, groups = [], []
    for g, (_, test) in enumerate(GROUPS):
        for e in sorted(vecs, key=ord):
            name = unicodedata.name(e, '')
            if e not in chosen and name and test(name):
                chosen.append(e)
                groups.append(g)
    names = [unicodedata.name(e).lower() for e in chosen]
    texts = [f'Here is a picture of a {n}.' for n in names]
    H = states(texts, lambda i: names[i])[LAYER]
    return {
        'title': 'Emoji, twice',
        'blurb': f'{len(chosen)} emoji. One view is emoji2vec, learned from how people '
                 'describe each emoji. The other is how Qwen reads its official Unicode '
                 'name (“clock face three oclock”, “waning gibbous moon symbol”).',
        'labels': chosen,
        'glyphs': True,  # the label is the picture
        'subs': names,
        'groups': groups,
        'group_names': [g[0] for g in GROUPS],
        'notes': {
            "neighbors": "The clock faces keep their friends best: everyone agrees that three o’clock lives next to four o’clock."
        },
        'cite': ['emoji2vec', 'qwen25'],
        'reading': {'barcodes': ['ph_language']},
        'views': [
            {'name': 'emoji2vec', 'X': np.stack([vecs[e] for e in chosen]), 'metric': 'cosine'},
            {'name': f'Qwen reads the name', 'X': H, 'metric': 'cosine'},
        ],
    }
