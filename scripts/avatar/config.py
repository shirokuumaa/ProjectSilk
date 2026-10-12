# scripts/avatar/config.py
#
# Общие настройки сборки и калибровки болванки.
# Импортируется и из Blender, и из обычного python3 — поэтому без bpy.

import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]

BLENDER = os.environ.get("BLENDER", "/Applications/Blender.app/Contents/MacOS/Blender")

GLB_PATH = REPO / "client" / "public" / "models" / "base_avatar.glb"
CALIBRATION_PATH = REPO / "client" / "src" / "data" / "avatarCalibration.json"
OUT_DIR = HERE / "out"                      # картинки и отчёты, в git не попадают
BUILD_INFO_PATH = OUT_DIR / "build_info.json"

MAX_GLB_BYTES = 5 * 1024 * 1024

# Нейтральная фигура: взрослая женщина, все прочие параметры MPFB посередине.
NEUTRAL_MACROS = {
    "gender": 0.0,
    "age": 0.5,
    "muscle": 0.5,
    "weight": 0.5,
    "proportions": 0.5,
    "height": 0.5,
    "cupsize": 0.5,
    "firmness": 0.5,
    "race": {"asian": 1 / 3, "caucasian": 1 / 3, "african": 1 / 3},
}

# Детальные таргеты MPFB, которые входят в нейтральную фигуру: сглаживаем соски.
NEUTRAL_DETAIL_TARGETS = {"breast/nipple-point-decr": 1.0, "breast/nipple-size-decr": 1.0}

# Бельё (топ-бандо и трусы) — маска по вершинам, расстояния от ориентиров нейтральной фигуры, м.
# Подобрано по картинкам out/underwear*.png.
UNDERWEAR = {
    "top_below_nipple": 0.075,     # нижний край топа — под складкой груди
    "top_above_nipple": 0.075,     # верхний край — ниже подмышек
    "brief_top_frac": 0.40,        # верх трусов: доля расстояния пах → соски
    "brief_side_frac": 0.20,       # вырез на бедре сбоку: та же доля
    "brief_gusset": 0.035,         # полуширина ластовицы у паха
    "brief_side_x": 0.16,          # где вырез достигает верхней точки (|x|)
    "brief_back_factor": 0.45,     # сзади вырез ниже — трусы закрывают ягодицы
    "clamp": 0.03,
}

# Наши морфы. Каждый — пара ключей <name>_incr / <name>_decr.
# Источник: "macro" — запекаем разницу макроса MPFB (0.5 → 1.0 и 0.5 → 0.0);
# "targets" — файлы таргетов MPFB, включённые на 1.0 одновременно.
CONTROLS = [
    ("height",     {"macro": "height"}),
    ("bust",       {"targets": ["torso/measure-bust-circ"]}),
    ("waist",      {"targets": ["torso/measure-waist-circ"]}),
    ("hips",       {"targets": ["torso/measure-hips-circ"]}),
    ("shoulder",   {"targets": ["torso/measure-shoulder-dist"]}),
    ("weight",     {"macro": "weight"}),
    ("arm_length", {"targets": ["arms/measure-upperarm-length", "arms/measure-lowerarm-length"]}),
    ("leg_length", {"targets": ["legs/measure-upperleg-height", "legs/measure-lowerleg-height"]}),
]
CONTROL_NAMES = [name for name, _ in CONTROLS]
KEY_NAMES = [f"{name}_{side}" for name in CONTROL_NAMES for side in ("incr", "decr")]

# Обмеры в сантиметрах (имена совпадают с полями BodyProfile, кроме arm_length/inseam).
MEASURES = ["height", "bust", "waist", "hips", "shoulder", "arm_length", "inseam"]

TOLERANCE_CM = 1.5

# Допустимые значения морфов [min, max]. За ±1 выходим только для тех морфов,
# у которых на картинках при таком значении нет изломов (см. render_check.py stretch).
CONTROL_LIMITS = {name: [-1.0, 1.0] for name in CONTROL_NAMES}
# Проверено на out/stretch_*.png: при больших значениях появляются складки
# на боках (weight 2), «беременный» живот (waist 2), горб на спине (bust 1.5),
# «галифе» уже с hips 1 (ограничено до 0.75 после просмотра); плечи до −2 сужаются
# гладко, на −2.5 слишком покатые.
CONTROL_LIMITS.update({"weight": [-1.0, 1.5], "waist": [-1.0, 1.5], "bust": [-1.0, 1.25],
                       "hips": [-1.0, 0.75], "shoulder": [-2.0, 1.0]})

# Регуляризация подбора: чем меньше число, тем охотнее решатель двигает этот морф.
# Полнота дешевле локальных обхватов — общую прибавку тело набирает полнотой.
REGULARIZATION = {
    "height": 1e-4, "weight": 1e-3,
    "bust": 1e-2, "waist": 1e-2, "hips": 1e-2,
    "shoulder": 1e-2, "arm_length": 1e-2, "leg_length": 1e-2,
}

# Тестовые фигуры: рост, грудь, талия, бёдра, плечи (по спине), рука, внутренний шов.
TEST_FIGURES = {
    "petite": {"height": 150, "bust": 78,  "waist": 60,  "hips": 84,  "shoulder": 35, "arm_length": 51, "inseam": 68},
    "small":  {"height": 156, "bust": 80,  "waist": 62,  "hips": 86,  "shoulder": 36, "arm_length": 54, "inseam": 72},
    "medium": {"height": 166, "bust": 92,  "waist": 74,  "hips": 99,  "shoulder": 39, "arm_length": 58, "inseam": 77},
    "large":  {"height": 172, "bust": 110, "waist": 94,  "hips": 118, "shoulder": 42, "arm_length": 60, "inseam": 79},
    "plus":   {"height": 166, "bust": 125, "waist": 110, "hips": 132, "shoulder": 43, "arm_length": 58, "inseam": 75},
}
