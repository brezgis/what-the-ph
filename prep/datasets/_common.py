"""Shared bits: the cyclic word list and a reader for the streamed fastText rows."""

from pathlib import Path

import numpy as np

RAW = Path(__file__).parent.parent / 'raw'

# (english, russian, group). Everything here goes round in a circle in real life.
WORDS = [
    *[(e, r, 0) for e, r in zip(
        'january february march april may june july august september october november december'.split(),
        'январь февраль март апрель май июнь июль август сентябрь октябрь ноябрь декабрь'.split())],
    *[(e, r, 1) for e, r in zip(
        'monday tuesday wednesday thursday friday saturday sunday'.split(),
        'понедельник вторник среда четверг пятница суббота воскресенье'.split())],
    *[(e, r, 2) for e, r in zip(
        'spring summer autumn winter'.split(),
        'весна лето осень зима'.split())],
    *[(e, r, 3) for e, r in zip(
        'dawn morning noon evening dusk night midnight'.split(),
        'рассвет утро полдень вечер сумерки ночь полночь'.split())],
    *[(e, r, 4) for e, r in zip(
        'north east south west'.split(),
        'север восток юг запад'.split())],
    *[(e, r, 5) for e, r in zip(
        'one two three four five six seven eight nine ten eleven twelve'.split(),
        'один два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать'.split())],
]
GROUP_NAMES = ['months', 'weekdays', 'seasons', 'times of day', 'directions', 'clock numbers']


def fasttext(lang, words):
    want = set(words)
    found = {}
    with open(RAW / f'ft.{lang}.vec', encoding='utf-8') as f:
        next(f)  # header
        for line in f:
            w, rest = line.split(' ', 1)
            if w in want and w not in found:
                found[w] = np.array(rest.split(), dtype=np.float32)
    missing = want - set(found)
    if missing:
        raise SystemExit(f'fastText {lang} missing: {sorted(missing)}')
    return np.stack([found[w] for w in words])
