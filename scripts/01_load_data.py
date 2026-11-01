r"""
Частина 1.1 — завантаження сирих даних Spotify Tracks Dataset у колекцію `tracks_raw`.

Запуск:
    .\venv\Scripts\python.exe scripts\01_load_data.py

Скрипт ідемпотентний: колекція `tracks_raw` видаляється перед кожним завантаженням.
"""

import os
import sys
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from pymongo import MongoClient
from tqdm import tqdm

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Шукаємо .env у корені проєкту, а не в поточній робочій директорії,
# щоб скрипт працював при запуску з будь-якого місця.
load_dotenv(PROJECT_ROOT / ".env")

# .env, згенерований онбордингом Atlas, називає змінну MONGODB_URI,
# у завданні вона MONGO_URI — приймаємо будь-яку.
MONGO_URI = os.getenv("MONGO_URI") or os.getenv("MONGODB_URI")
if not MONGO_URI:
    sys.exit("Не знайдено MONGO_URI (або MONGODB_URI) у .env — див. .env.example")

DB_NAME = os.getenv("DB_NAME", "spotify")
CSV_PATH = PROJECT_ROOT / "dataset.csv"
BATCH_SIZE = 1000

if not CSV_PATH.exists():
    sys.exit(f"Не знайдено {CSV_PATH} — завантажте датасет з Kaggle (див. README)")

client = MongoClient(MONGO_URI)
db = client[DB_NAME]

# Видаляємо колекцію якщо існує — для ідемпотентного повторного запуску
db["tracks_raw"].drop()

# index_col=0 — у CSV перша колонка безіменна, це просто номер рядка
df = pd.read_csv(CSV_PATH, index_col=0)
print(f"Прочитано з CSV: {len(df)} рядків")

# Прибираємо записи, в яких немає виконавця або назви треку.
# Робимо це ДО приведення типів, бо astype(int) падає на NaN: у цьому дампі
# неповний рядок має пропуски лише в текстових колонках, але покладатися на це не варто.
missing = df["artists"].isna() | df["track_name"].isna()
if missing.any():
    print(f"Відкинуто рядків без artists/track_name: {int(missing.sum())}")
df = df[~missing]

# Приводимо типи
df["explicit"] = df["explicit"].astype(bool)

# Цілі числа
int_cols = ["popularity", "duration_ms", "key", "mode", "time_signature"]
for col in int_cols:
    df[col] = df[col].astype(int)

# Числа з плаваючою точкою
float_cols = [
    "danceability", "energy", "loudness", "speechiness",
    "acousticness", "instrumentalness", "liveness",
    "valence", "tempo",
]
for col in float_cols:
    df[col] = df[col].astype(float)

records = df.to_dict("records")
print(f"Завантажуємо {len(records)} треків...")

# Завантажуємо батчами — вставка 114k документів однією операцією може впасти по пам'яті
for i in tqdm(range(0, len(records), BATCH_SIZE)):
    db["tracks_raw"].insert_many(records[i : i + BATCH_SIZE])

print(f"Завантажено документів: {db['tracks_raw'].count_documents({})}")
print("Приклад документа:")
print(db["tracks_raw"].find_one())

client.close()
