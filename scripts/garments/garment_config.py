# scripts/garments/garment_config.py
#
# Тестовые вещи для подгонки одежды на болванке (вариант B).
# Одежда MPFB/MakeHuman — CC0 (makehuman_system_assets.json).

from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
OUT_DIR = HERE / "out"                                    # эталоны, прогоны, картинки (в git не попадают)
GARMENTS_DIR = REPO / "client" / "public" / "models" / "test-garments"
MANIFEST_PATH = GARMENTS_DIR / "manifest.json"
TEXTURE_SIZE = 512

# Комплект MPFB → какие куски берём. У casualsuit02 футболка та же, что у 01, — берём только шорты.
SUITS = {
    "female_casualsuit01": {"top": "tee", "bottom": "jeans"},
    "female_casualsuit02": {"bottom": "shorts"},
    "female_elegantsuit01": {"top": "blouse", "bottom": "skirt"},
    "female_sportsuit01": {"top": "croptop", "bottom": "leggings"},
}

# Размерные сетки — обмеры самих изделий, см (как продавец заполняет SizeChartEditor).
# Шаг между размерами ~6 см, как в типичных женских сетках.
ITEMS = {
    "tee":      {"name": "Test tee",      "garmentType": "top",    "fit": "regular", "stretch": 5,
                 "sizes": {"S": {"chest": 90, "waist": 86, "hips": 92}, "M": {"chest": 96, "waist": 92, "hips": 98},
                           "L": {"chest": 102, "waist": 98, "hips": 104}}},
    "blouse":   {"name": "Test blouse",   "garmentType": "top",    "fit": "regular", "stretch": 0,
                 "sizes": {"S": {"chest": 88, "waist": 74, "hips": 92}, "M": {"chest": 94, "waist": 80, "hips": 98},
                           "L": {"chest": 100, "waist": 86, "hips": 104}}},
    "croptop":  {"name": "Test crop top", "garmentType": "top",    "fit": "tight",   "stretch": 20,
                 "sizes": {"S": {"chest": 80, "waist": 66}, "M": {"chest": 86, "waist": 72}, "L": {"chest": 92, "waist": 78}}},
    "jeans":    {"name": "Test jeans",    "garmentType": "bottom", "fit": "regular", "stretch": 2,  "legs": "split",
                 "sizes": {"S": {"waist": 66, "hips": 92}, "M": {"waist": 72, "hips": 98}, "L": {"waist": 78, "hips": 104}}},
    "leggings": {"name": "Test leggings", "garmentType": "bottom", "fit": "tight",   "stretch": 30, "legs": "split",
                 "sizes": {"S": {"waist": 60, "hips": 84}, "M": {"waist": 66, "hips": 90}, "L": {"waist": 72, "hips": 96}}},
    "shorts":   {"name": "Test shorts",   "garmentType": "bottom", "fit": "regular", "stretch": 2,  "legs": "split",
                 "sizes": {"S": {"waist": 66, "hips": 92}, "M": {"waist": 72, "hips": 98}, "L": {"waist": 78, "hips": 104}}},
    "skirt":    {"name": "Test skirt",    "garmentType": "bottom", "fit": "regular", "stretch": 2,  "legs": "joined",
                 "sizes": {"S": {"waist": 66, "hips": 92}, "M": {"waist": 72, "hips": 98}, "L": {"waist": 78, "hips": 104}}},
}

# Наше платье из генерации по фото — уже лежит в client/public/uploads/stub/dress.glb.
DRESS = {"name": "Test dress (photo generation)", "garmentType": "dress", "fit": "regular", "stretch": 2,
         "legs": "joined", "file": "/uploads/stub/dress.glb",
         "sizes": {"S": {"chest": 88, "waist": 72, "hips": 96}, "M": {"chest": 94, "waist": 78, "hips": 102},
                   "L": {"chest": 100, "waist": 84, "hips": 108}}}

# «Как от продавца»: вещь посажена на заметно другую фигуру, без привязки к телу,
# прорежена, в миллиметрах, чуть повёрнута и сдвинута (так приходит генерация по фото).
SELLER_FIGURE = {"height": 0.15, "bust": 0.6, "waist": 0.8, "hips": 0.5, "weight": 1.0}
SELLER_DECIMATE = 0.6
SELLER_SCALE = 1000.0
SELLER_YAW_DEG = 4.0
SELLER_OFFSET_M = (0.03, 0.0, 0.02)
