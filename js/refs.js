/* refs.js — every citation on the page, keyed. Each was checked against its
 * official source (DOI, ACL Anthology, PMLR, OpenReview, publisher) on 2026-10-14.
 * FiveThirtyEight article URLs now redirect to ABC News, so those point at the
 * official fivethirtyeight/data folders, which link the articles. */
window.REFS = {
  // ---- data & models ----
  fasttext: { text: 'Bojanowski, Grave, Joulin, et al. (2017). Enriching Word Vectors with Subword Information. TACL 5:135–146.', url: 'https://aclanthology.org/Q17-1010/' },
  fasttext_aligned: { text: 'Joulin, Bojanowski, Mikolov, et al. (2018). Loss in Translation: Learning Bilingual Word Mapping with a Retrieval Criterion. EMNLP 2018.', url: 'https://aclanthology.org/D18-1330/' },
  qwen25: { text: 'Qwen Team (2024). Qwen2.5 Technical Report. arXiv:2412.15115.', url: 'https://arxiv.org/abs/2412.15115' },
  coil20: { text: 'Nene, Nayar, Murase (1996). Columbia Object Image Library (COIL-20). Tech. Report CUCS-005-96, Columbia University.', url: 'https://www.cs.columbia.edu/CAVE/software/softlib/coil-20.php' },
  mnist: { text: 'LeCun, Bottou, Bengio, et al. (1998). Gradient-Based Learning Applied to Document Recognition. Proceedings of the IEEE 86(11):2278–2324.', url: 'https://doi.org/10.1109/5.726791' },
  quickdraw: { text: 'Ha, Eck (2018). A Neural Representation of Sketch Drawings. ICLR 2018.', url: 'https://openreview.net/forum?id=Hy6GHpkCW' },
  quickdraw_page: { text: 'Google Creative Lab (2017). The Quick, Draw! Dataset. CC BY 4.0.', url: 'https://github.com/googlecreativelab/quickdraw-dataset' },
  dinov2: { text: 'Oquab, Darcet, Moutakanni, et al. (2024). DINOv2: Learning Robust Visual Features without Supervision. TMLR.', url: 'https://openreview.net/forum?id=a68SUt6zFt' },
  emoji2vec: { text: 'Eisner, Rocktäschel, Augenstein, et al. (2016). emoji2vec: Learning Emoji Representations from their Description. SocialNLP Workshop @ EMNLP 2016.', url: 'https://aclanthology.org/W16-6208/' },
  candy: { text: 'Hickey, W. (2017). The Ultimate Halloween Candy Power Ranking. FiveThirtyEight.', url: 'https://github.com/fivethirtyeight/data/tree/master/candy-power-ranking' },
  bobross_538: { text: 'Hickey, W. (2014). A Statistical Analysis of the Work of Bob Ross. FiveThirtyEight.', url: 'https://github.com/fivethirtyeight/data/tree/master/bob-ross' },
  bobross_paints: { text: 'Wilber, J. Bob Ross Paintings dataset, via Hull, F., BobRossColors; TidyTuesday 2023-02-21.', url: 'https://github.com/jwilber/Bob_Ross_Paintings' },

  // ---- methods ----
  mds: { text: 'Torgerson (1952). Multidimensional Scaling: I. Theory and Method. Psychometrika 17(4):401–419.', url: 'https://doi.org/10.1007/BF02288916' },
  mutual_knn: { text: 'Huh, Cheung, Wang, et al. (2024). The Platonic Representation Hypothesis. ICML 2024, PMLR 235.', url: 'https://proceedings.mlr.press/v235/huh24a.html' },
  procrustes: { text: 'Schönemann (1966). A Generalized Solution of the Orthogonal Procrustes Problem. Psychometrika 31(1):1–10.', url: 'https://doi.org/10.1007/BF02289451' },
  procrustes_words: { text: 'Conneau, Lample, Ranzato, et al. (2018). Word Translation Without Parallel Data. ICLR 2018.', url: 'https://openreview.net/forum?id=H196sainb' },
  rsa: { text: 'Kriegeskorte, Mur, Bandettini (2008). Representational Similarity Analysis – Connecting the Branches of Systems Neuroscience. Frontiers in Systems Neuroscience 2:4.', url: 'https://doi.org/10.3389/neuro.06.004.2008' },
  cka: { text: 'Kornblith, Norouzi, Lee, et al. (2019). Similarity of Neural Network Representations Revisited. ICML 2019, PMLR 97:3519–3529.', url: 'https://proceedings.mlr.press/v97/kornblith19a.html' },
  ph_edelsbrunner: { text: 'Edelsbrunner, Letscher, Zomorodian (2002). Topological Persistence and Simplification. Discrete & Computational Geometry 28(4):511–533.', url: 'https://doi.org/10.1007/s00454-002-2885-2' },
  ph_ghrist: { text: 'Ghrist (2008). Barcodes: The Persistent Topology of Data. Bulletin of the AMS 45(1):61–75.', url: 'https://doi.org/10.1090/S0273-0979-07-01191-3' },
  ph_carlsson: { text: 'Carlsson (2009). Topology and Data. Bulletin of the AMS 46(2):255–308.', url: 'https://doi.org/10.1090/S0273-0979-09-01249-X' },
  ripser: { text: 'Bauer (2021). Ripser: Efficient Computation of Vietoris–Rips Persistence Barcodes. Journal of Applied and Computational Topology 5:391–423.', url: 'https://doi.org/10.1007/s41468-021-00071-5' },
  ph_images: { text: 'Carlsson, Ishkhanov, de Silva, et al. (2008). On the Local Behavior of Spaces of Natural Images. International Journal of Computer Vision 76(1):1–12.', url: 'https://doi.org/10.1007/s11263-007-0056-x' },
  circular_coords: { text: 'de Silva, Morozov, Vejdemo-Johansson (2011). Persistent Cohomology and Circular Coordinates. Discrete & Computational Geometry 45(4):737–759.', url: 'https://doi.org/10.1007/s00454-011-9344-x' },
  ph_language: { text: 'Jakubowski, Gašić, Zibrowius (2020). Topology of Word Embeddings: Singularities Reflect Polysemy. *SEM 2020.', url: 'https://aclanthology.org/2020.starsem-1.11/' },
  engels: { text: 'Engels, Michaud, Liao, et al. (2025). Not All Language Model Features Are One-Dimensionally Linear. ICLR 2025.', url: 'https://proceedings.iclr.cc/paper_files/paper/2025/hash/d3221cdb27e49d9c1cd35ad254feccfe-Abstract-Conference.html' },
  twonn: { text: 'Facco, d’Errico, Rodriguez, et al. (2017). Estimating the Intrinsic Dimension of Datasets by a Minimal Neighborhood Information. Scientific Reports 7:12140.', url: 'https://doi.org/10.1038/s41598-017-11873-y' },
  id_dnn: { text: 'Ansuini, Laio, Macke, et al. (2019). Intrinsic Dimension of Data Representations in Deep Neural Networks. NeurIPS 2019.', url: 'https://proceedings.neurips.cc/paper/2019/hash/cfcce0621b49c983991ead4c3d4d3b6b-Abstract.html' },
};
