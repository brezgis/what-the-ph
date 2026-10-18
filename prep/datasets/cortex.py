"""Man and monkey IT: Kriegeskorte et al. (2008), the 92 images.

The same 92 colour photographs of isolated objects were shown to two macaques
(674 IT single cells, Kiani et al. 2007) and to four people (fMRI, the 316 most
visually responsive IT voxels). For each species the paper compares the response
patterns of every pair of images by correlation distance, 1 − Pearson r across
cells or voxels, and the two 92 × 92 RDMs of its Fig. 1 are the two views here.

Both come from the RSA toolbox's demo data (rsagroup/rsatoolbox,
demos/92imageData/Kriegeskorte_Neuron2008_supplementalData.mat, MIT licence):
`RDMs_mIT_hIT_fig1` holds them as condensed vectors (MATLAB squareform order,
which is scipy's). The human one is the average of eight RDMs, two fMRI sessions
for each of four subjects, as the paper says; it matches the mean of the
per-session RDMs in 92_brainRDMs.mat to within 2e-7. The images and their
categories come from `stimuli_92objs` in the same file. The objects have no
names in the data, so the hover labels are ours, read off the photographs.
"""

import base64
import io

import numpy as np
import scipy.io as sio
from PIL import Image
from scipy.spatial.distance import squareform

from ._common import RAW

MAT = RAW / 'cortex' / 'Kriegeskorte_Neuron2008_supplementalData.mat'

GROUP_NAMES = ['human bodies', 'human faces', 'animal bodies', 'animal faces',
               'natural objects', 'artificial objects']
SINGULAR = ['human body', 'human face', 'animal body', 'animal face',
            'natural object', 'artificial object']
CATEGORY = {'human bodypart': 0, 'human face': 1, 'nonhuman bodypart': 2,
            'nonhuman face': 3, 'natural inanimate': 4, 'artificial inanimate': 5}

# what each photograph shows, in the file's order (ours, from looking at them)
NAMES = [
    'hand', 'ear', 'hand', 'chef', 'back of a head', 'dancer', 'woman', 'hand',
    'eye', 'man', 'pointing hand', 'fist',
    'man', 'man in sunglasses', 'smiling woman', 'man', 'man', 'woman', 'man',
    'man in glasses', 'child', 'man', 'woman', 'man',
    'armadillo', 'camel', 'green snake', 'wolf', 'monkey', 'ostrich', 'coral snake',
    'zebra', 'elephant', 'ape', 'sheep', 'frog',
    'cow', 'goat', 'monkey', 'chimpanzee', 'German shepherd', 'Great Dane', 'baboon',
    'macaque', 'crocodile', 'giraffe', 'lion', 'young monkey',
    'carrots', 'grapes', 'potato', 'shrub', 'chili pepper', 'lettuce', 'kiwi',
    'cucumber', 'maple leaf', 'apple core', 'radish', 'aubergine',
    'lake', 'pine cone', 'banana', 'tomato', 'garlic', 'country road', 'tree',
    'pineapple', 'pear', 'red pepper', 'waterfall',
    'city', 'baby bottle', 'light bulb', 'roundabout sign', 'cassette', 'church',
    'Japanese flag', 'key', 'pliers', 'arch', 'door', 'hammer', 'chair',
    'pistol', 'brick building', 'dome', 'umbrella', 'mobile phone', 'house', 'stove',
    'no-entry sign',
]


def thumb(rgb, size=44):
    """The photograph with its flat grey (128,128,128) background cut away."""
    a = np.asarray(rgb)
    alpha = np.where((np.abs(a.astype(int) - 128) <= 2).all(-1), 0, 255).astype(np.uint8)
    im = Image.fromarray(np.dstack([a, alpha]), 'RGBA')
    im = im.crop(im.getbbox()) if im.getbbox() else im
    w, h = im.size
    k = size / max(w, h)
    im = im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    im = im.quantize(64, method=Image.FASTOCTREE)
    buf = io.BytesIO()
    im.save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def load():
    m = sio.loadmat(MAT, squeeze_me=True, struct_as_record=False)
    rdm = {r.name: squareform(r.RDM) for r in m['RDMs_mIT_hIT_fig1']}
    stim = m['stimuli_92objs']
    assert len(stim) == len(NAMES) == 92
    groups = [CATEGORY[s.category] for s in stim]
    return {
        'title': 'Man and monkey IT',
        'blurb': 'The same 92 photographs shown to people in a scanner and to monkeys with '
                 'electrodes in inferior temporal cortex. Each view is how differently that '
                 'brain region responds to every pair of images.',
        'labels': NAMES,
        'subs': [SINGULAR[g] for g in groups],
        'groups': groups,
        'group_names': GROUP_NAMES,
        'thumbs': [thumb(s.image) for s in stim],
        'thumbs_color': True,
        'reading': {'rsa': ['kriegeskorte2008', 'kiani2007']},
        'metric_note': 'Both views are correlation distance as published, 1 − Pearson r between '
                       'the response patterns two images evoke: across 316 IT voxels for people '
                       '(averaged over eight sessions), across 674 IT neurons for monkeys.',
        'views': [
            {'name': 'human IT (fMRI)', 'D': rdm['hITvisStim_316vx']},
            {'name': 'monkey IT (cells)', 'D': rdm['mIT_674neurons']},
        ],
    }
