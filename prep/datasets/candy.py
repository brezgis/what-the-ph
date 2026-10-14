import csv

import numpy as np

from ._common import RAW

INGREDIENTS = ['chocolate', 'fruity', 'caramel', 'peanutyalmondy', 'nougat',
               'crispedricewafer', 'hard', 'bar', 'pluribus']


def load():
    rows = list(csv.DictReader(open(RAW / 'candy-data.csv')))
    A = np.array([[float(r[c]) for c in INGREDIENTS] for r in rows])
    B = np.array([[float(r['sugarpercent']), float(r['pricepercent']),
                   float(r['winpercent']) / 100] for r in rows])
    return {
        'title': 'Halloween candy',
        'blurb': 'FiveThirtyEight’s 85 candies. One view is what they are made of '
                 '(nine yes/no ingredients). The other is a real 3-D space: sugar, '
                 'price, and how often people picked it in a head-to-head.',
        'labels': [r['competitorname'] for r in rows],
        'subs': [f'wins {float(r["winpercent"]):.0f}% of matchups' for r in rows],
        'notes': {
            "neighbors": "Chocolate bars keep their friends; the oddballs (Whoppers, Werther’s, fruit snacks) get completely new neighbors once you sort by sugar, price and popularity."
        },
        'cite': ['candy'],
        'views': [
            {'name': 'ingredients', 'X': A, 'metric': 'jaccard'},
            {'name': 'sugar · price · love', 'X': B, 'metric': 'euclidean'},
        ],
    }
