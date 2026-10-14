"""Official names and verbatim descriptions, quoted from each creator's own page
(checked 2026-10-14). `here` is ours: what subset this toy uses, in our words."""

SRC = {
    'coil20': {'name': 'Columbia Object Image Library (COIL-20)',
               'quote': 'The second, [processed], contains images for all of the objects in which the background has been discarded (and the images consist of the smallest square that contains the object).',
               'url': 'https://www.cs.columbia.edu/CAVE/software/softlib/coil-20.php', 'label': 'Columbia CAVE'},
    'mnist': {'name': 'THE MNIST DATABASE of handwritten digits',
              'quote': 'The MNIST database of handwritten digits, available from this page, has a training set of 60,000 examples, and a test set of 10,000 examples. It is a subset of a larger set available from NIST.',
              'url': 'https://web.archive.org/web/20231229081350/http://yann.lecun.com/exdb/mnist/', 'label': 'LeCun’s MNIST page (archived)'},
    'quickdraw': {'name': 'The Quick, Draw! Dataset',
                  'quote': 'The Quick Draw Dataset is a collection of 50 million drawings across 345 categories, contributed by players of the game Quick, Draw!.',
                  'url': 'https://github.com/googlecreativelab/quickdraw-dataset', 'label': 'Google Creative Lab'},
    'candy': {'name': 'The Ultimate Halloween Candy Power Ranking',
              'quote': 'candy-data.csv includes attributes for each candy along with its ranking. For binary variables, 1 means yes, 0 means no.',
              'url': 'https://github.com/fivethirtyeight/data/tree/master/candy-power-ranking', 'label': 'FiveThirtyEight'},
    'bobross_538': {'name': 'A Statistical Analysis of the Work of Bob Ross',
                    'quote': 'elements-by-episode.csv tracks 67 different elements found in Bob Ross paintings featured in “The Joy of Painting” (S01E01 to S31E13).',
                    'url': 'https://github.com/fivethirtyeight/data/tree/master/bob-ross', 'label': 'FiveThirtyEight'},
    'bobross_paints': {'name': 'Bob_Ross_Paintings',
                       'quote': 'This repo stores data from the paintings of Bob Ross featured in the TV Show \'The Joy of Painting\'',
                       'url': 'https://github.com/jwilber/Bob_Ross_Paintings', 'label': 'Jared Wilber'},
    'emoji2vec': {'name': 'emoji2vec',
                  'quote': 'In this repository, we present the code that we used to train our representations of emoji, the training data we used to do so, and several tools for analyzing the performance of the vectors trained.',
                  'url': 'https://github.com/uclnlp/emoji2vec', 'label': 'UCL NLP'},
    'fasttext_aligned': {'name': 'Aligned word vectors',
                         'quote': 'We are publishing aligned word vectors for 44 languages based on the pre-trained vectors computed on Wikipedia using fastText. The alignments are performed with the RCSLS method described in Joulin et al (2018).',
                         'url': 'https://fasttext.cc/docs/en/aligned-vectors.html', 'label': 'fasttext.cc'},
    'fasttext_wiki': {'name': 'Wiki word vectors',
                      'quote': 'We are publishing pre-trained word vectors for 294 languages, trained on Wikipedia using fastText.',
                      'url': 'https://fasttext.cc/docs/en/pretrained-vectors.html', 'label': 'fasttext.cc'},
    'qwen': {'name': 'Qwen2.5-0.5B',
             'quote': 'Qwen2.5 is the latest series of Qwen large language models. For Qwen2.5, we release a number of base language models and instruction-tuned language models ranging from 0.5 to 72 billion parameters.',
             'url': 'https://huggingface.co/Qwen/Qwen2.5-0.5B', 'label': 'Qwen model card'},
    'dinov2': {'name': 'DINOv2',
               'quote': 'DINOv2 models produce high-performance visual features that can be directly employed with classifiers as simple as linear layers on a variety of computer vision tasks',
               'url': 'https://github.com/facebookresearch/dinov2', 'label': 'Meta FAIR'},
    'unicode': {'name': 'Unicode Character Database: Name',
                'quote': 'When a string value not enclosed in <angle brackets> occurs in this field, it specifies the character’s Name property value, which matches exactly the name published in the code charts.',
                'url': 'https://www.unicode.org/reports/tr44/', 'label': 'UAX #44'},
}

# title = the official name the chip shows; about = sources, in order
ABOUT = {
    'layers': ('Calendar words: Qwen2.5-0.5B', ['qwen', 'fasttext_wiki'],
               'Here: the twelve month names, as Wiki word vectors (A) and as Qwen2.5-0.5B layer-10 states averaged over six sentences like “She was born in ___” (B).'),
    'clock': ('Aligned word vectors', ['fasttext_aligned'],
              'Here: 46 words for things that go round (months, weekdays, seasons, times of day, directions, one to twelve), in English (A) and Russian (B).'),
    'turntable': ('COIL-20', ['coil20', 'dinov2'],
                  'Here: 5 objects × 36 angles (every 10°) from the processed set, as 32×32 pixels (A) and DINOv2 embeddings (B).'),
    'doodles': ('The Quick, Draw! Dataset', ['quickdraw', 'dinov2'],
                'Here: 30 drawings each of cat, clock, moon, bicycle, sun, fish, snail and donut, as 28×28 pixels (A) and DINOv2 embeddings (B).'),
    'mnist': ('MNIST', ['mnist', 'dinov2'],
              'Here: 30 test-set images of each digit, as pixels (A) and DINOv2 embeddings (B).'),
    'emoji': ('emoji2vec', ['emoji2vec', 'unicode', 'qwen'],
              'Here: 209 single-character emoji, as emoji2vec vectors (A) and as Qwen2.5-0.5B reading each emoji’s Unicode name (B).'),
    'candy': ('The Ultimate Halloween Candy Power Ranking', ['candy'],
              'Here: all 85 candies, as their nine yes/no attributes (A) and as sugar percentile, price percentile and win percentage (B).'),
    'bobross': ('Bob_Ross_Paintings', ['bobross_538', 'bobross_paints'],
                'Here: 400 episodes, as the 66 scene elements in each painting (A) and the 18 paints used (B).'),
}


def apply(base):
    """Official name + quoted descriptions. Newer datasets carry their own
    datasets/<id>.meta.json instead of an entry here:
      {"title": str, "about": [{"name","quote","url","label"}], "here": str,
       "cite": [ref keys], "refs": {key: {"text","url"}}}"""
    if base['id'] in ABOUT:
        title, keys, here = ABOUT[base['id']]
        base['title'] = title
        base['about'] = [SRC[k] for k in keys]
        base['here'] = here
        return base
    import json
    from pathlib import Path
    meta = json.loads((Path(__file__).parent / f"{base['id']}.meta.json").read_text())
    base['title'] = meta['title']
    base['about'] = meta['about']
    base['here'] = meta['here']
    base['cite'] = meta.get('cite') or base.get('cite')
    base['refs'] = meta.get('refs') or {}   # citations specific to this dataset
    return base
