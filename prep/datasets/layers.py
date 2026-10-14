import numpy as np

from ._common import fasttext
from ._lm import MODEL, states

MONTHS = 'January February March April May June July August September October November December'.split()
CARRIERS = [
    'The festival is held every year in {W}.',
    'She was born in {W}.',
    'It always rains in {W}.',
    'We moved here last {W}.',
    'The report is due in {W}.',
    'In {W} the days feel different.',
]
LAYER = 10


def load():
    # one point per month: its hidden state averaged over six carrier sentences
    H = np.mean([states([c.format(W=m) for m in MONTHS], lambda i: MONTHS[i])
                 for c in CARRIERS], axis=0)
    return {
        'title': 'A calendar inside a model',
        'blurb': 'Twelve months. As static fastText vectors they are just a smudge, '
                 f'but inside {MODEL.split("/")[1]} (layer {LAYER}, averaged over six '
                 'sentences like “She was born in ___”) they close up into a loop, '
                 'in calendar order.',
        'labels': MONTHS,
        'notes': {
            "cloud": "That lonely dot is May. To fastText it is mostly a verb (“may I?”), which is a good reminder that static vectors blend every sense of a word together.",
            "cka": "fastText vectors carry no context at all; Qwen’s were averaged over six sentences. That they agree even this much is a little surprising."
        },
        'cite': ['fasttext', 'qwen25'],
        'reading': {'cloud': ['engels'], 'barcodes': ['engels', 'ph_language']},
        'views': [
            {'name': 'fastText', 'X': fasttext('en', [m.lower() for m in MONTHS]), 'metric': 'cosine'},
            {'name': f'Qwen layer {LAYER}', 'X': H[LAYER], 'metric': 'cosine'},
        ],
        'layers': {'names': [f'L{i}' for i in range(len(H))], 'Xs': list(H)},
    }
