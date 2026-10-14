from ._common import GROUP_NAMES, WORDS, fasttext


def load():
    en = [w[0] for w in WORDS]
    ru = [w[1] for w in WORDS]
    return {
        'title': 'Clockwork words',
        'blurb': f'Months, weekdays, seasons, hours and compass points: words for things '
                 'that go round. The same {len(WORDS)} concepts as English and as Russian '
                 'fastText vectors (300 dimensions each, aligned into one space).',
        'labels': en,
        'subs': ru,
        'labels_b': ru,  # the Russian cloud is labelled in Russian
        'groups': [w[2] for w in WORDS],
        'group_names': GROUP_NAMES,
        'notes': {
            "cka": "Caveat: these vectors were trained to be aligned across languages (that is what “aligned” means here), so a high score is partly by construction. The interesting bits are where they still disagree.",
            "neighbors": "Weekdays are the most loyal. Numbers like five and six are the most fickle, probably because Russian numerals inflect for case and also show up in dates, prices and ages."
        },
        'cite': ['fasttext_aligned', 'fasttext'],
        'reading': {'barcodes': ['engels', 'ph_language']},
        'views': [
            {'name': 'English', 'X': fasttext('en', en), 'metric': 'cosine'},
            {'name': 'Russian', 'X': fasttext('ru', ru), 'metric': 'cosine'},
        ],
    }
