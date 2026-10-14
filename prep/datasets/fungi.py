"""Fungi: one ITS barcode per well-known species, read two ways.

Source: UNITE general FASTA release for Fungi, v10.0 (2025-02-19, dynamic
species hypotheses), DOI 10.15156/BIO/3301229, CC BY 4.0:
    https://s3.hpc.ut.ee/plutof-public/original/9489f7bc-7cc1-4e0a-84dc-c732476b9acd.tgz
saved as raw/fungi/unite.tgz and unpacked to raw/fungi/x/.

View A: normalised 4-mer counts of the ITS sequence (256 numbers, cosine).
View B: Nucleotide Transformer v2 (50M, multi-species; CC BY-NC-SA 4.0, fine
for this private non-commercial toy) mean-pooled last-layer states. Its custom
model code needs transformers 4.x (the prep env has 5.x), so the embeddings are
made once and cached:

    cd prep && nice uv run --no-project --with 'transformers<4.48' --with torch \\
        --with numpy python -m datasets.fungi embed

which writes raw/fungi/seqs.fasta (the chosen sequences) and raw/fungi/nt50m.npy.
`load()` itself only needs numpy.
"""

import itertools
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

RAW = Path(__file__).parent.parent / 'raw' / 'fungi'
FASTA = RAW / 'x' / 'sh_general_release_dynamic_19.02.2025.fasta'
MODEL = 'InstaDeepAI/nucleotide-transformer-v2-50m-multi-species'
K = 4

# (UNITE species name, common name). Chosen by hand: famous, edible, deadly,
# useful or weird. Where UNITE's dynamic release has no SH named for the classic
# species, a close stand-in is used and the common name says so.
SPECIES = [
    # chanterelles & tooth fungi
    ('Cantharellus cibarius', 'golden chanterelle'), ('Cantharellus cinnabarinus', 'cinnabar chanterelle'),
    ('Craterellus cornucopioides', 'black trumpet'), ('Craterellus tubaeformis', 'yellowfoot'),
    ('Hydnum repandum', 'hedgehog mushroom'),
    # Amanitas
    ('Amanita muscaria', 'fly agaric'), ('Amanita phalloides', 'death cap'), ('Amanita virosa', 'destroying angel'),
    ('Amanita bisporigera', 'eastern destroying angel'), ('Amanita pantherina', 'panther cap'),
    ('Amanita caesarea', "Caesar's mushroom"), ('Amanita rubescens', 'the blusher'),
    ('Amanita citrina', 'false death cap'), ('Amanita fulva', 'tawny grisette'),
    # supermarket & forager favourites
    ('Agaricus bisporus', 'button mushroom'), ('Agaricus campestris', 'field mushroom'),
    ('Agaricus arvensis', 'horse mushroom'), ('Agaricus subrufescens', 'almond mushroom'),
    ('Lentinula edodes', 'shiitake'), ('Pleurotus ostreatus', 'oyster mushroom'),
    ('Pleurotus pulmonarius', 'Indian oyster'), ('Pleurotus citrinopileatus', 'golden oyster'),
    ('Pleurotus djamor', 'pink oyster'), ('Flammulina velutipes', 'velvet shank'),
    ('Flammulina filiformis', 'enoki'), ('Hypsizygus marmoreus', 'beech mushroom (shimeji)'),
    ('Volvariella volvacea', 'paddy straw mushroom'), ('Stropharia rugosoannulata', 'wine cap'),
    ('Cyclocybe aegerita', 'poplar mushroom'), ('Tricholoma matsutake', 'matsutake'),
    ('Tricholoma equestre', 'yellow knight'), ('Calocybe gambosa', "St George's mushroom"),
    ('Marasmius oreades', 'fairy ring champignon'), ('Lepista nuda', 'wood blewit'),
    ('Clitocybe nebularis', 'clouded agaric'), ('Macrolepiota procera', 'parasol'),
    ('Chlorophyllum molybdites', 'green-spored parasol'),
    # boletes
    ('Boletus edulis', 'porcini'), ('Boletus reticulatus', 'summer cep'), ('Boletus pinophilus', 'pine bolete'),
    ('Imleria badia', 'bay bolete'), ('Suillus luteus', 'slippery jack'), ('Suillus bovinus', 'Jersey cow bolete'),
    ('Leccinum scabrum', 'birch bolete'), ('Leccinum versipelle', 'orange birch bolete'),
    ('Xerocomellus chrysenteron', 'red cracking bolete'), ('Tylopilus felleus', 'bitter bolete'),
    # ink caps & little brown mushrooms
    ('Coprinus comatus', 'shaggy ink cap'), ('Coprinopsis atramentaria', 'common ink cap'),
    ('Coprinopsis cinerea', 'grey ink cap (lab model)'), ('Coprinellus micaceus', 'glistening ink cap'),
    ('Psilocybe cubensis', 'magic mushroom'), ('Psilocybe semilanceata', 'liberty cap'),
    ('Psilocybe cyanescens', 'wavy cap'), ('Panaeolus cinctulus', 'banded mottlegill'),
    ('Armillaria mellea', 'honey fungus'), ('Armillaria borealis', 'northern honey fungus'),
    ('Hypholoma fasciculare', 'sulphur tuft'), ('Pholiota squarrosa', 'shaggy scalycap'),
    ('Galerina marginata', 'funeral bell'), ('Cortinarius rubellus', 'deadly webcap'),
    ('Cortinarius orellanus', "fool's webcap"), ('Inocybe geophylla', 'white fibrecap'),
    ('Entoloma sinuatum', 'livid pinkgill'), ('Laccaria amethystina', 'amethyst deceiver'),
    ('Laccaria laccata', 'the deceiver'), ('Hygrocybe coccinea', 'scarlet waxcap'),
    ('Hygrocybe conica', "witch's hat"),
    # glowing & oddballs
    ('Mycena chlorophos', 'glowing bonnet'), ('Panellus stipticus', 'bitter oyster (glows)'),
    ('Omphalotus olearius', "jack-o'-lantern"), ('Omphalotus illudens', "eastern jack-o'-lantern"),
    ('Schizophyllum commune', 'split gill'),
    # milk caps & brittlegills
    ('Russula emetica', 'the sickener'), ('Russula virescens', 'green-cracking russula'),
    ('Lactarius deliciosus', 'saffron milk cap'), ('Lactarius indigo', 'indigo milk cap'),
    ('Lactifluus volemus', 'weeping milk cap'), ('Hericium erinaceus', "lion's mane"),
    ('Hericium coralloides', 'coral tooth'),
    # brackets & polypores
    ('Ganoderma lucidum', 'reishi'), ('Ganoderma sichuanense', 'lingzhi'), ('Ganoderma applanatum', "artist's conk"),
    ('Trametes versicolor', 'turkey tail'), ('Fomes fomentarius', 'tinder fungus'),
    ('Fomitopsis pinicola', 'red-belted conk'), ('Fomitopsis officinalis', 'agarikon'),
    ('Laetiporus sulphureus', 'chicken of the woods'), ('Grifola frondosa', 'maitake'),
    ('Inonotus obliquus', 'chaga'), ('Fistulina hepatica', 'beefsteak fungus'),
    ('Sparassis crispa', 'cauliflower fungus'), ('Serpula lacrymans', 'dry rot'),
    ('Phanerochaete chrysosporium', 'white rot (lab model)'), ('Heterobasidion parviporum', 'conifer root rot'),
    ('Stereum hirsutum', 'hairy curtain crust'), ('Thelephora terrestris', 'earthfan'),
    # corals
    ('Ramaria botrytis', 'rosso coral'), ('Clavulina coralloides', 'crested coral'),
    ('Clavaria fragilis', 'white spindles'), ('Calocera viscosa', 'yellow stagshorn'),
    # puffballs, earthstars, stinkhorns, bird's nests
    ('Calvatia gigantea', 'giant puffball'), ('Lycoperdon perlatum', 'common puffball'),
    ('Lycoperdon pyriforme', 'pear-shaped puffball'), ('Bovista plumbea', 'paltry puffball'),
    ('Scleroderma citrinum', 'common earthball'), ('Geastrum triplex', 'collared earthstar'),
    ('Geastrum fimbriatum', 'sessile earthstar'), ('Astraeus hygrometricus', 'barometer earthstar'),
    ('Phallus impudicus', 'common stinkhorn'), ('Phallus indusiatus', 'veiled lady'),
    ('Mutinus caninus', 'dog stinkhorn'), ('Clathrus ruber', 'red cage'), ('Clathrus archeri', "devil's fingers"),
    ('Aseroe coccinea', 'scarlet starfish fungus'), ('Cyathus striatus', "fluted bird's nest"),
    ('Crucibulum laeve', "common bird's nest"),
    # jelly fungi
    ('Auricularia auricula-judae', 'wood ear'), ('Auricularia cornea', 'cloud ear'),
    ('Tremella fuciformis', 'snow fungus'), ('Tremella mesenterica', "witches' butter"),
    ('Exidia glandulosa', "black witches' butter"),
    # rusts & smuts
    ('Puccinia graminis', 'wheat stem rust'), ('Puccinia striiformis', 'wheat stripe rust'),
    ('Puccinia coronata', 'crown rust of oats'), ('Hemileia vastatrix', 'coffee rust'),
    ('Gymnosporangium juniperi-virginianae', 'cedar-apple rust'), ('Cronartium ribicola', 'white pine blister rust'),
    ('Melampsora laricis-populina', 'poplar rust'), ('Phakopsora pachyrhizi', 'soybean rust'),
    ('Ustilago maydis', 'corn smut (huitlacoche)'), ('Ustilago esculenta', 'wild-rice smut (makomotake)'),
    ('Ustilago hordei', 'barley covered smut'), ('Tilletia indica', 'Karnal bunt of wheat'),
    ('Sporisorium reilianum', 'head smut'),
    # basidiomycete yeasts
    ('Cryptococcus neoformans', 'Cryptococcus'), ('Malassezia globosa', 'dandruff yeast'),
    ('Malassezia restricta', 'scalp yeast'), ('Rhodotorula mucilaginosa', 'pink shower yeast'),
    ('Wallemia sebi', 'jam mould'),
    # ascomycete yeasts
    ('Saccharomyces cerevisiae', "baker's & brewer's yeast"), ('Saccharomyces pastorianus', 'lager yeast'),
    ('Saccharomyces kudriavzevii', 'wild Saccharomyces'), ('Schizosaccharomyces pombe', 'fission yeast'),
    ('Candida albicans', 'thrush yeast'), ('Candida auris', 'Candida auris'),
    ('Nakaseomyces glabratus', 'Candida glabrata'), ('Dekkera bruxellensis', 'Brett (sour beer yeast)'),
    ('Kluyveromyces lactis', 'dairy yeast'), ('Komagataella phaffii', 'Pichia (lab protein factory)'),
    ('Debaryomyces hansenii', 'cheese-rind yeast'), ('Yarrowia lipolytica', 'oily yeast'),
    ('Geotrichum candidum', 'milk mould'), ('Pneumocystis jirovecii', 'Pneumocystis'),
    ('Taphrina deformans', 'peach leaf curl'),
    # morels, cups & truffles
    ('Morchella americana', 'yellow morel'), ('Morchella importuna', 'black morel'),
    ('Morchella semilibera', 'half-free morel'), ('Gyromitra esculenta', 'false morel'),
    ('Verpa bohemica', 'early false morel'), ('Helvella crispa', 'white saddle'),
    ('Sarcoscypha coccinea', 'scarlet elf cup'), ('Aleuria aurantia', 'orange peel fungus'),
    ('Peziza vesiculosa', 'blistered cup'), ('Otidea onotica', "hare's ear"),
    ('Tuber melanosporum', 'black Périgord truffle'), ('Tuber magnatum', 'white Alba truffle'),
    ('Tuber aestivum', 'summer truffle'), ('Tuber borchii', 'bianchetto truffle'),
    ('Tuber indicum', 'Chinese truffle'), ('Terfezia boudieri', 'desert truffle'),
    # moulds & food fungi
    ('Penicillium chrysogenum', 'penicillin mould'), ('Penicillium rubens', "Fleming's penicillin mould"),
    ('Penicillium roqueforti', 'blue cheese mould'), ('Penicillium camemberti', 'camembert rind'),
    ('Penicillium digitatum', 'green citrus mould'), ('Penicillium expansum', 'apple blue mould'),
    ('Aspergillus niger', 'citric acid mould'), ('Aspergillus flavus', 'aflatoxin mould (koji’s wild twin)'),
    ('Aspergillus fumigatus', 'Aspergillus fumigatus'), ('Aspergillus nidulans', 'lab Aspergillus'),
    ('Monascus purpureus', 'red yeast rice'), ('Fusarium venenatum', 'Quorn mycoprotein'),
    ('Neurospora crassa', 'red bread mould'), ('Trichoderma reesei', 'Trichoderma (stonewashed jeans)'),
    ('Trichoderma harzianum', 'Trichoderma harzianum'), ('Cladosporium herbarum', 'Cladosporium'),
    ('Alternaria alternata', 'Alternaria'), ('Stachybotrys chartarum', 'toxic black mould'),
    # plant & animal pathogens
    ('Fusarium graminearum', 'wheat head blight'), ('Fusarium oxysporum', 'Fusarium wilt'),
    ('Pyricularia oryzae', 'rice blast'), ('Botrytis cinerea', 'grey mould / noble rot'),
    ('Sclerotinia sclerotiorum', 'white mould'), ('Blumeria graminis', 'powdery mildew'),
    ('Erysiphe necator', 'grape powdery mildew'), ('Cryphonectria parasitica', 'chestnut blight'),
    ('Ophiostoma novo-ulmi', 'Dutch elm disease'), ('Hymenoscyphus fraxineus', 'ash dieback'),
    ('Venturia inaequalis', 'apple scab'), ('Trichophyton rubrum', "athlete's foot"),
    ('Microsporum canis', 'ringworm'), ('Histoplasma capsulatum', 'Histoplasma'),
    ('Coccidioides immitis', 'valley fever'),
    # insect & grass partners
    ('Cordyceps militaris', 'scarlet caterpillar club'), ('Ophiocordyceps sinensis', 'caterpillar fungus'),
    ('Ophiocordyceps unilateralis', 'zombie-ant fungus'), ('Beauveria bassiana', 'white muscardine'),
    ('Metarhizium anisopliae', 'green muscardine'), ('Tolypocladium inflatum', 'cyclosporin fungus'),
    ('Claviceps paspali', 'ergot (of dallisgrass)'), ('Epichloe typhina', 'choke of grasses'),
    ('Hypomyces lactifluorum', 'lobster mushroom'),
    # flask fungi
    ('Xylaria hypoxylon', 'candlesnuff'), ('Xylaria polymorpha', "dead man's fingers"),
    ('Daldinia concentrica', "King Alfred's cakes"), ('Chlorociboria aeruginascens', 'green elf cup'),
    # lichens
    ('Xanthoria parietina', 'common orange lichen'), ('Cladonia rangiferina', 'reindeer lichen'),
    ('Usnea florida', 'beard lichen'), ('Lobaria pulmonaria', 'lungwort lichen'),
    ('Peltigera aphthosa', 'freckle pelt lichen'), ('Parmelia sulcata', 'hammered shield lichen'),
    ('Evernia prunastri', 'oakmoss'), ('Umbilicaria esculenta', 'rock tripe (iwatake)'),
    ('Cetraria islandica', 'Iceland moss'), ('Letharia lupina', 'wolf lichen'),
    ('Graphis scripta', 'script lichen'),
    # early-branching fungi
    ('Rhizopus stolonifer', 'black bread mould'), ('Rhizopus arrhizus', 'rice-wine mould'),
    ('Rhizopus microsporus', 'tempeh mould'), ('Mucor mucedo', 'pin mould'),
    ('Mucor circinelloides', 'Mucor'), ('Phycomyces blakesleeanus', 'Phycomyces'),
    ('Pilobolus crystallinus', 'hat thrower'), ('Mortierella alpina', 'soil mould (ARA oil)'),
    ('Rhizophagus irregularis', 'arbuscular mycorrhiza'), ('Funneliformis mosseae', 'arbuscular mycorrhiza (F. mosseae)'),
    ('Gigaspora margarita', 'Gigaspora'), ('Conidiobolus coronatus', 'Conidiobolus'),
    ('Basidiobolus ranarum', 'frog-gut fungus'), ('Batrachochytrium dendrobatidis', 'amphibian chytrid'),
    ('Batrachochytrium salamandrivorans', 'salamander chytrid'), ('Synchytrium endobioticum', 'potato wart'),
    ('Allomyces arbusculus', 'water mould Allomyces'), ('Neocallimastix frontalis', 'cow-gut fungus'),
    ('Rozella allomycetis', 'Rozella'),
]

GROUP_NAMES = ['mushrooms & brackets', 'rusts, smuts & basidio yeasts', 'yeasts (ascomycete)',
               'cups, morels & truffles', 'lichens', 'moulds & pathogens', 'early-branching fungi']


def _group(tax):
    t = dict(x.split('__', 1) for x in tax.split(';'))
    p, c = t['p'], t['c']
    if p == 'Basidiomycota':
        return 0 if c == 'Agaricomycetes' else 1
    if p == 'Ascomycota':
        if c in ('Saccharomycetes', 'Schizosaccharomycetes', 'Pneumocystomycetes', 'Taphrinomycetes'):
            return 2
        if c == 'Pezizomycetes':
            return 3
        if c in ('Lecanoromycetes', 'Arthoniomycetes'):
            return 4
        return 5
    return 6


def _records():
    recs = defaultdict(list)
    with open(FASTA) as f:
        for head, seq in itertools.zip_longest(f, f):
            name, acc, sh, kind, tax = head[1:].rstrip('\n').split('|')
            recs[name].append((kind, acc, sh, tax, seq.strip().upper()))
    return recs


def choose():
    """One sequence per species: prefer UNITE's reference (`refs`) sequences,
    then the one whose length is closest to the species median."""
    recs = _records()
    out = []
    for sp, common in SPECIES:
        cand = recs[sp.replace(' ', '_')]
        if not cand:
            raise SystemExit(f'not in UNITE: {sp}')
        refs = [c for c in cand if c[0] == 'refs'] or cand
        med = np.median([len(c[4]) for c in refs])
        kind, acc, sh, tax, seq = min(refs, key=lambda c: (abs(len(c[4]) - med), c[1]))
        out.append(dict(species=sp, common=common, acc=acc, sh=sh, tax=tax, seq=seq))
    return out


def kmers(seq, k=K):
    idx = {''.join(p): i for i, p in enumerate(itertools.product('ACGT', repeat=k))}
    v = np.zeros(4 ** k)
    for i in range(len(seq) - k + 1):
        j = idx.get(seq[i:i + k])   # skips IUPAC ambiguity codes
        if j is not None:
            v[j] += 1
    return v / v.sum()


def embed():
    import torch
    from transformers import AutoModelForMaskedLM, AutoTokenizer
    items = choose()
    with open(RAW / 'seqs.fasta', 'w') as f:
        for it in items:
            f.write(f">{it['species'].replace(' ', '_')}|{it['acc']}|{it['sh']}|{it['tax']}\n{it['seq']}\n")
    tok = AutoTokenizer.from_pretrained(MODEL, trust_remote_code=True)
    model = AutoModelForMaskedLM.from_pretrained(MODEL, trust_remote_code=True).eval()
    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    model.to(dev)
    E = []
    with torch.no_grad():
        for it in items:
            x = tok([it['seq']], return_tensors='pt', truncation=True, max_length=1000).to(dev)
            h = model(**x, output_hidden_states=True).hidden_states[-1][0]
            m = x['attention_mask'][0].bool()
            m[0] = False                      # drop the <cls> token
            E.append(h[m].mean(0).float().cpu().numpy())
    np.save(RAW / 'nt50m.npy', np.stack(E))
    print('saved', np.stack(E).shape)


def load():
    items = choose()
    B = np.load(RAW / 'nt50m.npy')
    assert len(B) == len(items), 'stale raw/fungi/nt50m.npy: re-run `python -m datasets.fungi embed`'
    A = np.stack([kmers(it['seq']) for it in items])
    groups = [_group(it['tax']) for it in items]
    phylum = [dict(x.split('__', 1) for x in it['tax'].split(';'))['p'] for it in items]
    return {
        'title': 'Fungi',
        'blurb': f'{len(items)} famous fungi, from the death cap to baker’s yeast, each as one '
                 'DNA barcode (the ITS region). One view just counts its four-letter DNA '
                 'words; the other is how a DNA language model reads the same sequence.',
        'labels': [it['common'] for it in items],
        'subs': [f"{it['species']} · {p}" for it, p in zip(items, phylum)],
        'groups': groups,
        'group_names': GROUP_NAMES,
        'cite': ['unite', 'nt'],
        'views': [
            {'name': 'DNA letters', 'X': A, 'metric': 'cosine'},
            {'name': 'a DNA language model’s reading', 'X': B, 'metric': 'cosine'},
        ],
    }


if __name__ == '__main__' and sys.argv[1:] == ['embed']:
    embed()
