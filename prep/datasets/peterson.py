"""Animal photos: people's similarity ratings vs. DINOv2.

Peterson, Abbott & Griffiths collected pairwise similarity ratings for 120 colour
photographs of animals on Amazon Mechanical Turk: every one of the 7,140 pairs
rated by 10 different people on a scale from 0 (not similar at all) to 10 (very
similar), 71,400 ratings from 209 people (CogSci 2016; the same animal set opens
their 2018 Cognitive Science paper, which adds five more domains). Only the
animals are published, in jcpeterson/percept2vec: `turkResults_CogSci2016.mat`
holds `simMatrix` (the mean rating per pair; it is exactly the mean of the two
collection batches also in the file, which correlate .91 with each other) and
`animals_big_idx`, the stimulus numbers of the rows, matching
`animals.zip/images/stim-NNNN.png`.

View A is that matrix as a distance: 10 − mean rating, so 0 = "very similar"
and 10 = "not similar at all" (the diagonal, rated 10 by construction, becomes 0).
View B is DINOv2's CLS embedding of the same photographs, under cosine distance,
the usual way to compare such embeddings (the paper itself used inner products of
network features).

The release has stimulus numbers, not names. The labels are ours, a common name
for what each photo shows; the groups are the nine clusters the authors found in
the human ratings (their Fig. 3), with each photo assigned by what it shows.
(Cutting a Ward clustering of the ratings into nine reproduces them, except that
the two lorises and the bushbaby land with the rodents.)
"""

from PIL import Image
from scipy.io import loadmat

from ._common import RAW
from ._vision import dino, thumb_orig

DIR = RAW / 'peterson'

# in the .mat's row order (ascending stimulus number)
LABELS = '''giraffe|deer|red-eyed tree frog|chimpanzee|fox|lizard|marmot|rhinoceros|giraffe|tree frog|
penguin|bushbaby|mandrill|rhinoceros|coyote|chimpanzee|lizard|slow loris|clouded leopard|bald eagle|
bald eagle|caribou|elephant|llama|orangutan|llama|monkey|orangutan|tiger|marmot|
tortoise|kudu|cheetah|elephant|slow loris|chimpanzee|tiger|penguin|colobus monkey|bobcat|
chimpanzee|tiger|snake|monkey|cougar|lion|ruffed lemur|colobus monkey|giant panda|elephant|
bighorn sheep|cardinal|penguin|bighorn sheep|anole|squirrel|bison|prairie dog|porcupine|gull|
brown bear|mandrill|green snake|rattlesnake|patas monkey|tree frog|deer|monkey|patas monkey|ocelot|
goat|tiger|tiger|brown bear|coyote|giraffe|penguin|chimpanzee|elephant seal|polar bear|
mountain goat|porcupine|colobus monkey|iguana|toad|gorilla|tortoise|lizard|deer|gorilla|
patas monkey|meadowlark|tiger|coyote|lioness|chipmunk|black bear|orangutan|caracal|thrush|
salamander|dolphin|giant tortoise|gorilla|chimpanzee|crocodile|snake|deer|mountain goat|frog|
prairie dog|coyote|caribou|tiger|bighorn sheep|zebra|chimpanzee|zebra|rooster|snake'''.replace('\n', '').split('|')

GROUP_NAMES = ['primate', 'rodent', 'bear', 'dog', 'wild cat', 'grazer', 'megafauna', 'bird', 'herp']
KIND = {
    0: 'chimpanzee orangutan gorilla monkey mandrill bushbaby lemur loris',
    1: 'marmot squirrel chipmunk prairie porcupine',
    2: 'bear panda',
    3: 'fox coyote',
    4: 'tiger lion lioness cheetah leopard bobcat cougar ocelot caracal',
    5: 'deer giraffe llama kudu sheep goat bison caribou zebra',
    6: 'elephant rhinoceros seal dolphin',
    7: 'penguin eagle cardinal gull meadowlark thrush rooster',
    8: 'frog toad lizard anole iguana snake rattlesnake tortoise crocodile salamander',
}


def group(label):
    hits = {g for g, words in KIND.items() for w in label.split() if w in words.split()}
    assert len(hits) == 1, (label, hits)
    return hits.pop()


def load():
    m = loadmat(DIR / 'turkResults_CogSci2016.mat', squeeze_me=True)
    S = m['simMatrix']
    D = 10.0 - S
    ims = [Image.open(DIR / 'animals' / 'images' / f'stim-{i:04d}.png').convert('RGB')
           for i in m['animals_big_idx']]
    return {
        'title': 'Animal photos',
        'blurb': '120 photos of animals, as people rated them (every pair, 0–10, ten '
                 'raters each) and as DINOv2 sees them.',
        'labels': LABELS,
        'subs': [f'stimulus {i}' for i in m['animals_big_idx']],
        'groups': [group(x) for x in LABELS],
        'group_names': GROUP_NAMES,
        'thumbs': [thumb_orig(im, 40) for im in ims],
        'thumbs_color': True,
        'notes': {
            'rsa': 'People sort strictly by kind: 96% of each photo’s five nearest neighbours are '
                   'in its group, against 85% for DINOv2. Closing that gap is what Peterson et al. set out to do.',
        },
        'reading': {'rsa': ['peterson_cogsci', 'peterson_cogs']},
        'metric_note': 'Here: people’s distance is 10 − the mean similarity rating (0–10, ten '
                       'raters per pair); DINOv2’s is cosine.',
        'views': [
            {'name': 'people', 'D': D},
            {'name': 'DINOv2', 'X': dino(ims), 'metric': 'cosine'},
        ],
    }
