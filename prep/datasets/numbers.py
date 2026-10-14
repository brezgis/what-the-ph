"""Numbers 0–99 as two LMs read them: Llama-3.2-1B sees one token per number,
Qwen2.5-0.5B sees one token per digit (its states are averaged over the digits)."""

import numpy as np

from .clocks import carrier_states

N = 100
VIEWS = [('meta-llama/Llama-3.2-1B', 8), ('Qwen/Qwen2.5-0.5B', 12)]
CARRIERS = [
    'I counted {T} sheep.',
    'There were {T} people at the party.',
    'The answer is {T}.',
    'She turned {T} last week.',
    'Page {T} is missing.',
    'We drove {T} miles today.',
]
ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen ' \
       'fifteen sixteen seventeen eighteen nineteen'.split()
TENS = [None, None, 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']


def word(n):
    if n < 20:
        return ONES[n]
    t, o = divmod(n, 10)
    return TENS[t] + ('' if o == 0 else '-' + ONES[o])


def load():
    items = [str(i) for i in range(N)]
    Hs = []
    for model, _ in VIEWS:          # one model in memory at a time (clocks._model swaps)
        Hs.append(carrier_states(model, items, CARRIERS))
    (ma, la), (mb, lb) = VIEWS
    A, B = Hs[0][la], Hs[1][lb]
    return {
        'title': 'Counting to 99',
        'blurb': 'The numbers 0 to 99, as two language models read them in sentences like '
                 '“I counted 42 sheep.” Llama-3.2-1B has a single token for every number up to '
                 '999; Qwen2.5-0.5B spells each one out digit by digit. Same numbers, two '
                 'ways of reading them.',
        'labels': items,
        'subs': [word(i) for i in range(N)],
        'groups': [i % 10 for i in range(N)],
        'group_names': [f'ends in {d}' for d in range(10)],
        'notes': {
            'neighbors': 'Llama’s neighbours of 7 are 6, 8, 5 and 9: size. Qwen’s are 77, 78, 79 and 76: '
                         'it shares the token “7”. Qwen also puts 42 next to 24, the same digits swapped.',
            'barcodes': 'No counting loop here. Qwen’s longest H1 bar (cosine) is a little ring of '
                        'numbers built from the digits 4–7 (46, 47, 57, 54, 74, 76, 77), held together '
                        'by shared and swapped digits rather than by size. Averaging Qwen’s numbers by last digit does give ten '
                        'points on a ring in order 0, 1, 2 … 9 (around layers 8–16), but the tens '
                        'carry about twice as much of the spread, so the ring is a small ripple on a '
                        'line. Llama’s last-digit averages are not a ring: they sort into even, odd, '
                        'and the multiples of 5.',
        },
        'cite': ['llama3', 'qwen25'],
        'reading': {'cloud': ['kantamneni', 'engels'], 'barcodes': ['kantamneni', 'engels']},
        'views': [
            {'name': f'Llama layer {la}', 'X': A, 'metric': 'cosine'},
            {'name': f'Qwen layer {lb}', 'X': B, 'metric': 'cosine'},
        ],
        'layers': {'names': [f'L{i}' for i in range(len(Hs[1]))], 'Xs': list(Hs[1])},
    }
