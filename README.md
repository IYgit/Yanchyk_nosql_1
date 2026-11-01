# Yanchyk_nosql_1 — Аналітична платформа для музичного стрімінгового сервісу

Домашнє завдання №1 курсу **NoSQL and Vector Databases** (GoIT).

Проєкт розгортає [Spotify Tracks Dataset](https://www.kaggle.com/datasets/maharshipandya/-spotify-tracks-dataset)
(≈114 000 треків) у MongoDB Atlas, трансформує плоскі CSV-дані у документоорієнтовану схему
засобами Aggregation Pipeline та будує поверх неї аналітичні запити.

---

## Зміст

- [Структура репозиторію](#структура-репозиторію)
- [Налаштування оточення](#налаштування-оточення)
- [Частина 1 — Завантаження та схема](#частина-1--завантаження-та-схема)
- [Схема даних](#схема-даних)
- [Теоретичні питання частини 1](#теоретичні-питання-частини-1)
- [Частина 2 — Запити](#частина-2--запити)
- [Частина 3 — Індекси та оптимізація](#частина-3--індекси-та-оптимізація)

---

## Структура репозиторію

```
.
├── .env                      # рядок підключення (НЕ комітиться, див. .env.example)
├── .env.example              # шаблон .env
├── .gitignore
├── requirements.txt
├── dataset.csv               # датасет з Kaggle (НЕ комітиться, ~20 МБ)
├── scripts/
│   ├── 01_load_data.py       # CSV → tracks_raw
│   └── 02_transform.js       # tracks_raw → tracks (MQL)
├── queries/
│   ├── part2_queries.js      # запити частини 2
│   └── part3_indexes.js      # індекси та explain() частини 3
├── outputs/                  # зафіксований вивід усіх скриптів
│   ├── 01_load_data.out
│   ├── 02_transform.out
│   ├── part2_queries.out
│   └── part3_indexes.out
└── README.md
```

---

## Налаштування оточення

### 1. Кластер MongoDB Atlas

1. Зареєструватися на [mongodb.com/atlas](https://www.mongodb.com/atlas), створити
   безкоштовний кластер **M0 Shared** (AWS, найближчий регіон).
2. **Database Access** → створити користувача з паролем.
3. **Network Access** → додати свій IP (або `0.0.0.0/0` для розробки).
4. **Connect → Drivers** → скопіювати рядок підключення `mongodb+srv://...`.

Atlas M0 уже працює як Replica Set із трьох нод — окремо налаштовувати нічого не потрібно.

### 2. Віртуальне оточення та залежності

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

`requirements.txt`:

```
pymongo==4.7.3
pandas==3.0.3
python-dotenv==1.0.1
tqdm==4.66.4
```

### 3. Файл `.env`

Скопіювати `.env.example` у `.env` і підставити свій рядок підключення:

```
MONGO_URI="mongodb+srv://<username>:<password>@<cluster>.mongodb.net/"
DB_NAME="spotify"
```

> `.env` додано до `.gitignore` і **не комітиться**.
> Скрипт `01_load_data.py` приймає як `MONGO_URI`, так і `MONGODB_URI` —
> друга назва використовується у `.env`, який генерує онбординг Atlas.

### 4. Датасет

`dataset.csv` не зберігається в репозиторії (≈20 МБ). Завантажити його у корінь проєкту:

```powershell
# варіант 1 — вручну з Kaggle
# https://www.kaggle.com/datasets/maharshipandya/-spotify-tracks-dataset

# варіант 2 — через Kaggle CLI
pip install kaggle==1.6.14
kaggle datasets download -d maharshipandya/-spotify-tracks-dataset -f dataset.csv --unzip
```

### 5. Порядок запуску

```powershell
# Частина 1.1 — CSV → tracks_raw
.\venv\Scripts\python.exe scripts\01_load_data.py

# Частина 1.2 — tracks_raw → tracks
mongosh "<MONGO_URI>/spotify" --quiet --file scripts\02_transform.js

# Частина 2 — запити
mongosh "<MONGO_URI>/spotify" --quiet --file queries\part2_queries.js

# Частина 3 — індекси та explain()
mongosh "<MONGO_URI>/spotify" --quiet --file queries\part3_indexes.js
```

Усі скрипти **ідемпотентні**: `01_load_data.py` скидає `tracks_raw`, `02_transform.js` скидає
`tracks`, `part3_indexes.js` скидає свої індекси перед заміром «плану без індексу».

---

## Частина 1 — Завантаження та схема

### 1.1. Завантаження сирих даних

`scripts/01_load_data.py` читає CSV, приводить типи й вставляє документи батчами по 1000
у колекцію `tracks_raw`.

Дві правки відносно скрипта із завдання:

| Що | Чому |
|---|---|
| `pd.read_csv(CSV_PATH, index_col=0)` | перша колонка CSV безіменна — це просто номер рядка, у базі він не потрібен |
| `dropna(subset=["artists","track_name"])` **до** приведення типів | захисний порядок: каст `astype(int)` падає на `NaN`, тому відкидати неповні рядки надійніше до кастів, а не після, як у вихідному скрипті |

У цьому датасеті неповний рядок лише один (індекс 65900, трек `1kR4gIb7nGxHPI3D2ifs59`,
жанр `k-pop`), і пропуски в ньому — тільки текстові: `artists`, `album_name`, `track_name`.
Усі числові колонки заповнені, тому на **цих** даних порядок із завдання теж відпрацював би
без помилки. Перестановка нічого не змінює в результаті (113 999 документів в обох випадках) —
вона лише знімає залежність від цієї властивості конкретного дампу.

Вивід (`outputs/01_load_data.out`):

```
Прочитано з CSV: 114000 рядків
Відкинуто рядків без artists/track_name: 1
Завантажуємо 113999 треків...
100%|##########| 114/114 [06:18<00:00,  3.32s/it]
Завантажено документів: 113999
Приклад документа:
{'_id': ObjectId('6ae774b6601468cb7c4a83be'),
 'track_id': '5SuOikwiRyPMVoIQDJUgSV',
 'artists': 'Gen Hoshino',
 'album_name': 'Comedy',
 'track_name': 'Comedy',
 'popularity': 73,
 'duration_ms': 230666,
 'explicit': False,
 'danceability': 0.676,
 'energy': 0.461,
 ...
 'track_genre': 'acoustic'}
```

### 1.2. Трансформація схеми

`scripts/02_transform.js` — п'ятистадійний Aggregation Pipeline:

| Стадія | Оператор | Що робить |
|---|---|---|
| 1 | `$project` | залишає лише потрібні поля, рядок виконавців перейменовує на `artists_raw` |
| 2 | `$addFields` + `$map`/`$split`/`$trim` | `"Ingrid Michaelson;ZAYN"` → `["Ingrid Michaelson", "ZAYN"]` |
| 3 | `$addFields` | збирає вкладений `audio_features`, додає `duration_sec` (`$round`) і `popularity_tier` (`$switch`) |
| 4 | `$unset` | прибирає плоскі аудіо-поля та `artists_raw` |
| 5 | `$out: "tracks"` | записує результат у колекцію `tracks` |

Вивід (`outputs/02_transform.out`):

```
Трансформацію завершено.
Документів у tracks: 113999
```

---

## Схема даних

Колекція `spotify.tracks`, 113 999 документів. Приклад реального документа:

```json
{
  "_id": { "$oid": "6ae776bf25ea7c3bbae9d981" },
  "track_id": "5SuOikwiRyPMVoIQDJUgSV",
  "album_name": "Comedy",
  "track_name": "Comedy",
  "popularity": 73,
  "duration_ms": 230666,
  "explicit": false,
  "track_genre": "acoustic",
  "artists": ["Gen Hoshino"],
  "audio_features": {
    "danceability": 0.676,
    "energy": 0.461,
    "loudness": -6.746,
    "speechiness": 0.143,
    "acousticness": 0.0322,
    "instrumentalness": 0.00000101,
    "liveness": 0.358,
    "valence": 0.715,
    "tempo": 87.917,
    "key": 1,
    "mode": 0,
    "time_signature": 4
  },
  "duration_sec": 230.7,
  "popularity_tier": "high"
}
```

### Поля

| Поле | Тип | Опис |
|---|---|---|
| `track_id` | `string` | ідентифікатор треку у Spotify |
| `track_name`, `album_name` | `string` | назва треку / альбому |
| `artists` | `string[]` | **масив** виконавців (розбитий по `;`) |
| `popularity` | `int` | 0–100 |
| `popularity_tier` | `string` | обчислюване: `high` (≥70), `medium` (40–69), `low` (<40) |
| `duration_ms` | `int` | тривалість у мілісекундах |
| `duration_sec` | `double` | обчислюване: тривалість у секундах, 1 знак після коми |
| `explicit` | `bool` | ненормативний контент |
| `track_genre` | `string` | жанр (114 унікальних значень) |
| `audio_features` | `object` | **вкладений об'єкт** з 12 аудіо-характеристиками |

### Характеристики даних після трансформації

| Метрика | Значення |
|---|---|
| Документів | 113 999 |
| Унікальних жанрів | 114 |
| Треків з більш ніж одним виконавцем | 30 075 (26 %) |
| `popularity_tier`: low / medium / high | 65 412 / 43 115 / 5 472 |

> Датасет містить дублікати треків по жанрах — один і той самий трек може бути віднесений
> до кількох жанрів (напр. `LOKERA` присутній і в `latin`, і в `latino`). Це властивість
> джерела, а не помилка трансформації, тому у результатах запитів такі треки трапляються двічі.

---

## Теоретичні питання частини 1

### Чому аудіо-характеристики винесені в окремий об'єкт `audio_features`, а не зберігаються плоско?

Передусім через **семантику**: `danceability`, `energy`, `tempo`, `key` тощо — це не самостійні
атрибути треку, а один зв'язний набір, який Spotify повертає як результат аудіоаналізу.
Плоский документ з 20 полів на одному рівні не каже нічого про те, що з них «метадані треку»
(`track_name`, `album_name`, `popularity`), а що — «показники сигналу». Вкладення робить цю
межу явною: документ читається як опис предметної області, а не як рядок CSV.

Практичні наслідки у цій схемі:

- **Проєкція одним полем.** `find({}, { track_name: 1, audio_features: 1 })` віддає весь блок фіч.
  Плоско довелося б перелічувати 12 імен, і кожне нове поле від Spotify ламало б усі такі запити.
- **Атомарне оновлення блоку.** Перерахунок аудіоаналізу — це `$set: { audio_features: {...} }`,
  одна операція над одним полем; MongoDB гарантує атомарність на рівні документа.
  Плоско це 12 незалежних `$set`, і часткове оновлення дасть змішаний стан.
- **Еволюція схеми.** Додати `acoustic_fingerprint` всередину `audio_features` можна, не
  торкаючись кореня документа і не ризикуючи колізією імен з метаданими.
- **Групування при валідації.** JSON Schema для вкладеного об'єкта описується одним
  блоком `properties.audio_features`.

Коли вкладення **створює проблеми**:

- **Довші шляхи у запитах та індексах.** Фільтр стає `"audio_features.danceability": { $gt: 0.7 }`,
  індекс — `{ "audio_features.danceability": 1 }`. Це дрібна, але постійна ціна: усі запити
  частин 2 і 3 оперують точковою нотацією, а помилка в шляху не дає помилки — дає тихо
  порожній результат.
- **Об'єкт не індексується як ціле осмислено.** Індекс по `{ audio_features: 1 }` індексує
  весь піддокумент як одне значення і працює лише для запитів на повний точний збіг
  з тим самим порядком ключів. Для діапазонних запитів потрібні індекси по кожному підполю окремо.
- **Якщо блок виростає або починає жити власним життям** — версіонування аудіоаналізу,
  кілька аналізів на трек, окремі права доступу — вкладений об'єкт доведеться винести
  в окрему колекцію, і це вже міграція. Вкладення виправдане саме тому, що тут зв'язок
  строго 1:1 і блок завжди читається разом з треком.
- **Ліміт документа 16 МБ** — тут нерелевантний (документ ~0.5 КБ), але це загальна межа
  для стратегії «вкладати все».

Орієнтир: вкладати варто те, що **завжди читається й оновлюється разом з батьківським
документом і має з ним зв'язок 1:1 чи 1:небагато**. `audio_features` — рівно цей випадок.

### Чому виконавці зберігаються як масив, а не як рядок? Які запити стають простішими?

У джерелі це рядок `"Ingrid Michaelson;ZAYN"` — тобто список, закодований у текст.
Поки він рядок, база не знає, що там два виконавці: будь-який запит про виконавця
перетворюється на роботу з підрядками. У цьому датасеті 30 075 треків (26 %) мають
більше одного виконавця, тож це не крайній випадок.

Що дає масив:

- **Точний пошук по елементу.** `find({ artists: "ZAYN" })` — MongoDB порівнює з *кожним*
  елементом масиву автоматично. На рядку це був би `$regex: /ZAYN/`, який знайде зайве
  (виконавця з таким підрядком у назві) і не зможе використати B-tree індекс:
  регулярка без прив'язки до початку рядка фактично вироджується в `COLLSCAN`.
- **Операторна арифметика над множинами.** `$in` — «будь-хто зі списку»,
  `$all: ["Drake", "Future"]` — «обидва на одному треку», `$size` — «скільки виконавців»,
  `"artists.1": { $exists: true }` — «колаборації» (саме так порахована метрика 26 % вище).
  На рядку кожне з цих питань — окрема регулярка з ризиком хибних збігів.
- **Мультиключовий індекс.** `createIndex({ artists: 1 })` індексує кожен елемент масиву
  окремим ключем, тому пошук по виконавцю — `IXSCAN`, а не сканування колекції.
- **Агрегація по виконавцях через `$unwind`.** Завдання 2 частини 2 саме на цьому:
  `$unwind: "$artists"` розгортає трек з трьома виконавцями на три документи, після чого
  `$group` по `artists` рахує `$sum`, `$min`, `$avg` популярності для кожного виконавця
  окремо — включно з його участю в колабораціях. На рядку таке групування неможливе без
  попередньої обробки на боці застосунку: `"Rauw Alejandro;Lyanno;Brray"` — це для `$group`
  один «виконавець», відмінний від `"Rauw Alejandro"`.

Ціна масиву: не можна зробити складений індекс по двох масивах, а `$unwind` перед `$group`
збільшує кількість документів у пайплайні. Для цього датасету обидва обмеження неістотні.

---

## Частина 2 — Запити

Файл: [`queries/part2_queries.js`](queries/part2_queries.js), повний вивід:
[`outputs/part2_queries.out`](outputs/part2_queries.out).

### Завдання 1. Треки для вечірки

`danceability > 0.7`, `energy > 0.7`, тривалість 3–5 хв.

```js
db.tracks.find(
  {
    "audio_features.danceability": { $gt: 0.7 },
    "audio_features.energy": { $gt: 0.7 },
    duration_ms: { $gte: 180000, $lte: 300000 }
  },
  {
    _id: 0, track_name: 1, artists: 1, track_genre: 1,
    popularity: 1, duration_sec: 1,
    "audio_features.danceability": 1, "audio_features.energy": 1
  }
).sort({ popularity: -1 }).limit(10);
```

**Знайдено треків: 7311.** Топ-3:

| track_name | artists | genre | popularity | danceability | energy |
|---|---|---|---|---|---|
| Calm Down (with Selena Gomez) | Rema, Selena Gomez | pop | 92 | 0.801 | 0.806 |
| LOKERA | Rauw Alejandro, Lyanno, Brray | latin | 91 | 0.834 | 0.828 |
| Party | Bad Bunny, Rauw Alejandro | reggaeton | 90 | 0.829 | 0.799 |

Тривалість фільтрується по `duration_ms`, а не по обчислюваному `duration_sec`, бо це
вихідне цілочисельне поле — межі із завдання задані саме в мілісекундах і не залежать
від округлення.

### Завдання 2. Виконавці, у яких усі треки популярні

Артист вважається популярним, якщо має **≥ 3 треки** і **мінімальна** популярність цих
треків ≥ 60. Ключова ідея: «усі треки популярні» = `$min` по групі не падає нижче 60.

```js
db.tracks.aggregate([
  { $unwind: "$artists" },
  { $group: {
      _id: "$artists",
      tracks_count:   { $sum: 1 },
      min_popularity: { $min: "$popularity" },
      avg_popularity: { $avg: "$popularity" }
  }},
  { $match: { tracks_count: { $gte: 3 }, min_popularity: { $gte: 60 } } },
  { $project: {
      _id: 0,
      artist: "$_id",
      tracks_count: 1,
      min_popularity: 1,
      avg_popularity: { $round: ["$avg_popularity", 1] }
  }},
  { $sort: { avg_popularity: -1, tracks_count: -1, artist: 1 } },
  { $limit: 20 }
]);
```

Фільтр проходять **334 артисти**, топ-20 за середньою популярністю:

| # | artist | tracks_count | min_popularity | avg_popularity |
|---|--------|--------------|----------------|----------------|
| 1 | Harry Styles | 3 | 89 | 92 |
| 2 | Luar La L | 4 | 90 | 90.5 |
| 3 | Olivia Rodrigo | 5 | 86 | 87.4 |
| 4 | BYOR | 4 | 87 | 87 |
| 5 | IVE | 3 | 79 | 84 |
| 6 | Måneskin | 12 | 76 | 83.7 |
| 7 | Lil Nas X | 11 | 77 | 83.5 |
| 8 | Morgan Wallen | 3 | 81 | 83.3 |
| 9 | One Direction | 5 | 80 | 83 |
| 10 | TV Girl | 5 | 80 | 82 |
| 11 | Mac DeMarco | 4 | 81 | 81.5 |
| 12 | Cults | 3 | 81 | 81.3 |
| 13 | Ricky Montgomery | 4 | 79 | 80.5 |
| 14 | Luke Combs | 3 | 79 | 80.3 |
| 15 | Declan McKenna | 3 | 80 | 80 |
| 16 | Joy Again | 3 | 80 | 80 |
| 17 | Mora | 7 | 69 | 79.7 |
| 18 | Maroon 5 | 3 | 70 | 79.7 |
| 19 | Beach Bunny | 7 | 73 | 79.4 |
| 20 | Gigi D'Agostino | 3 | 79 | 79 |

`$unwind` тут обов'язковий: без нього `$group` групував би по масиву як по цілому значенню,
і `["Rauw Alejandro","Lyanno","Brray"]` став би окремим «виконавцем».

### Завдання 3. Нетипові треки

Трек нетиповий, якщо `tempo > mean(жанр) + 2 × stdDevPop(жанр)`.

```js
db.tracks.aggregate([
  { $group: {
      _id: "$track_genre",
      avg_tempo: { $avg: "$audio_features.tempo" },
      std_tempo: { $stdDevPop: "$audio_features.tempo" },
      tracks: { $push: {
          _id: "$_id",
          track_name: "$track_name",
          popularity: "$popularity",
          artists: "$artists",
          audio_features: { tempo: "$audio_features.tempo" }
      }}
  }},
  { $addFields: {
      outlier_threshold: { $add: ["$avg_tempo", { $multiply: [2, "$std_tempo"] }] }
  }},
  { $project: {
      _id: 0,
      genre: "$_id",
      avg_tempo: { $round: ["$avg_tempo", 1] },
      outlier_threshold: { $round: ["$outlier_threshold", 1] },
      outlier_tracks: { $filter: {
          input: "$tracks",
          as: "t",
          cond: { $gt: ["$$t.audio_features.tempo", "$outlier_threshold"] }
      }}
  }},
  { $match: { "outlier_tracks.0": { $exists: true } } },
  { $sort: { genre: 1 } }
]);
```

Логіка: одна стадія `$group` одночасно рахує статистику жанру і **складає всі треки жанру
у масив** через `$push`. Завдяки цьому порог і треки для порівняння опиняються в одному
документі, і другий прохід по колекції не потрібен — `$filter` відбирає аномалії всередині
документа жанру. `$stdDevPop` (а не `$stdDevSamp`) — бо жанр розглядається як повна
генеральна сукупність, а не вибірка з неї.

**Результат: 112 жанрів із аномаліями, 3506 нетипових треків** (з 114 жанрів усього —
у двох розкид темпу такий, що порог не перевищує жоден трек).

Приклад результату для жанру `acoustic` — структура точно відповідає зразку із завдання:

```json
{
  "genre": "acoustic",
  "avg_tempo": 119,
  "outlier_threshold": 178.5,
  "outlier_tracks": [
    {
      "_id": { "$oid": "6ae776bf25ea7c3bbae9d984" },
      "track_name": "Can't Help Falling In Love",
      "popularity": 71,
      "artists": ["Kina Grannis"],
      "audio_features": { "tempo": 181.74 }
    },
    {
      "_id": { "$oid": "6ae776bf25ea7c3bbae9d9a1" },
      "track_name": "All I Want For Christmas Is A Real Good Tan",
      "popularity": 0,
      "artists": ["Chord Overstreet"],
      "audio_features": { "tempo": 202.019 }
    }
  ]
}
```

Зведення по кількох жанрах:

| genre | avg_tempo | outlier_threshold | аномалій |
|---|---|---|---|
| acoustic | 119 | 178.5 | 34 |
| afrobeat | 119.2 | 171.8 | 50 |
| chicago-house | 123.9 | 145.7 | 20 |
| classical | 107.9 | 170 | 37 |
| black-metal | 128.6 | 188.3 | 16 |

Цікаве спостереження: у `chicago-house` порог лише 145.7 при середньому 123.9 — темп у жанрі
дуже стабільний (мале стандартне відхилення), тому «нетиповим» стає навіть помірне відхилення.
У `classical`, навпаки, розкид величезний, і порог аж 170 при найнижчому із наведених
середньому темпі 107.9.

### Завдання 4. Треки для фонової роботи

```js
db.tracks.find(
  {
    "audio_features.loudness": { $lt: -10 },
    "audio_features.speechiness": { $lt: 0.1 },
    "audio_features.instrumentalness": { $gt: 0.5 },
    explicit: false
  },
  {
    _id: 0, track_name: 1, artists: 1, track_genre: 1,
    popularity: 1, duration_sec: 1,
    "audio_features.loudness": 1,
    "audio_features.speechiness": 1,
    "audio_features.instrumentalness": 1
  }
).sort({ popularity: -1 }).limit(10);
```

**Знайдено треків: 9324.** Найпопулярніший — `everything i wanted` (Billie Eilish, жанр
`electro`, popularity 86).

### Додатково. `$lookup` + `$unwind`

Останній блок скрипта показує багатоетапну агрегацію з join: для 10 найпопулярніших треків
корелюючий `$lookup` (з `let`/`pipeline`) рахує статистику їхнього жанру, `$unwind` розгортає
результат join, і `$project` порівнює енергію треку із середньою по жанру:

```js
{ $lookup: {
    from: "tracks",
    let: { genre: "$track_genre" },
    pipeline: [
      { $match: { $expr: { $eq: ["$track_genre", "$$genre"] } } },
      { $group: { _id: null,
          tracks_in_genre: { $sum: 1 },
          avg_energy:      { $avg: "$audio_features.energy" },
          avg_popularity:  { $avg: "$popularity" } } }
    ],
    as: "genre_stats"
}},
{ $unwind: "$genre_stats" }
```

Приклад: `Unholy (feat. Kim Petras)` має `energy = 0.472` проти середніх `0.606` у жанрі
`pop` — тобто помітно спокійніший за типовий поп-трек (`energy_vs_genre: -0.134`).

---

## Частина 3 — Індекси та оптимізація

> Додатковий блок.

Файл: [`queries/part3_indexes.js`](queries/part3_indexes.js), повний вивід:
[`outputs/part3_indexes.out`](outputs/part3_indexes.out).

Скрипт друкує з `explain("executionStats")` лише значущі поля: дерево `winningPlan`,
`nReturned`, `totalKeysExamined`, `totalDocsExamined`, `executionTimeMillis` і наявність
стадії `SORT`.

### Завдання 1. Аналіз запиту та індексація

```js
db.tracks.find({
  track_genre: "pop",
  "audio_features.danceability": { $gte: 0.7 }
}).sort({ popularity: -1 });
```

| Метрика | ДО індексу | ПІСЛЯ індексу |
|---|---|---|
| `winningPlan` | `SORT <- COLLSCAN` | `FETCH <- IXSCAN (genre_popularity_danceability)` |
| `nReturned` | 354 | 354 |
| `totalKeysExamined` | **0** | **412** |
| `totalDocsExamined` | **113 999** | **354** |
| `executionTimeMillis` | 103 | **2** |
| стадія `SORT` | так | **немає** |

Створений індекс:

```js
db.tracks.createIndex(
  { track_genre: 1, popularity: -1, "audio_features.danceability": 1 },
  { name: "genre_popularity_danceability" }
);
```

**Що змінилося в плані виконання.** Три речі.

1. **`COLLSCAN` → `IXSCAN`.** Без індексу MongoDB читала всі 113 999 документів і перевіряла
   умову на кожному: `totalDocsExamined = 113999` при `nReturned = 354` — співвідношення
   322:1, тобто 99.7 % роботи марна. З індексом сканується 412 ключів і читається рівно
   354 документи — співвідношення 1.16:1.
2. **Зникла стадія `SORT`.** Це ключова частина виграшу. У плані «до» сортування виконувалося
   в пам'яті вже після збору всіх відповідних документів. Індекс зберігає ключі впорядковано,
   тому `IXSCAN` віддає документи вже в потрібному порядку `popularity: -1` — сортувати
   нічого не потрібно. Це ще й знімає ризик помилки
   `Sort exceeded memory limit of 33554432 bytes` на великих вибірках.
3. **103 мс → 2 мс**, тобто ×50.

**Порядок полів в індексі важливіший за їх склад.** Скрипт створює для порівняння
«наївний» індекс з тими самими полями, але в порядку Equality → Range → Sort:

| Індекс | Порядок полів | План | SORT |
|---|---|---|---|
| `genre_popularity_danceability` | E → **S** → R | `FETCH <- IXSCAN` | немає |
| `genre_danceability_popularity_naive` | E → **R** → S | `FETCH <- SORT <- IXSCAN` | **є** |

Обидва використовують індекс і читають 354 документи, але «наївний» усе одно сортує в пам'яті:
як тільки в індексі зустрічається діапазон (`$gte`), порядок наступних за ним полів
у B-tree вже не відповідає глобальному порядку сортування. Саме тому застосовано
правило **ESR** — *Equality, Sort, Range*.

**Як зрозуміти, що індекс використовується.** Три ознаки з `explain()`:

1. `queryPlanner.winningPlan` містить стадію `IXSCAN` (а не `COLLSCAN`) і поле
   `indexName: "genre_popularity_danceability"`;
2. `executionStats.totalKeysExamined > 0` — без індексу воно завжди рівно `0`,
   бо ключі ніде не читаються;
3. `executionStats.totalDocsExamined` близьке до `nReturned` (354 проти 354), а не до
   розміру колекції.

Фрагмент реального виводу:

```
--- ДО створення індексу ---
winningPlan:            SORT <- COLLSCAN
nReturned:              354
totalKeysExamined:      0
totalDocsExamined:      113999
executionTimeMillis:    103
сортування в пам'яті:   так (стадія SORT)

Створюємо індекс: genre_popularity_danceability

--- ПІСЛЯ створення індексу ---
winningPlan:            FETCH <- IXSCAN (genre_popularity_danceability)
nReturned:              354
totalKeysExamined:      412
totalDocsExamined:      354
executionTimeMillis:    2
сортування в пам'яті:   ні
```

### Завдання 2. Індекс для пошуку музики для роботи

Запит (той самий, що в завданні 2.4):

```js
db.tracks.find({
  "audio_features.instrumentalness": { $gt: 0.5 },
  "audio_features.speechiness": { $lt: 0.1 },
  explicit: false
});
```

```js
db.tracks.createIndex(
  {
    explicit: 1,
    "audio_features.instrumentalness": 1,
    "audio_features.speechiness": 1
  },
  { name: "focus_instrumentalness_speechiness_explicit" }
);
```

| Метрика | ДО індексу | ПІСЛЯ індексу |
|---|---|---|
| `winningPlan` | `COLLSCAN` | `FETCH <- IXSCAN (focus_...)` |
| `nReturned` | 16 141 | 16 141 |
| `totalKeysExamined` | 0 | 16 602 |
| `totalDocsExamined` | 113 999 | 16 141 |
| `executionTimeMillis` | 154 | **39** |

`explicit` стоїть першим попри те, що в завданні він названий останнім: за правилом ESR
поле з умовою на **рівність** має бути попереду полів з діапазонами. Префікс по `explicit`
відсікає документи з `explicit: true` одразу на рівні B-tree, і далі скануються лише
піддерева потрібного значення. Два діапазони після нього дають точне обмеження по
`instrumentalness` і фільтрацію по `speechiness` всередині відсканованих ключів — звідси
16 602 прочитаних ключів на 16 141 результатів.

Виграш (×4) скромніший, ніж у завданні 1, і це очікувано: запит повертає 14 % колекції,
а індекс тим вигідніший, чим селективніший фільтр. Головне, що зникло сканування
113 999 документів.

### Завдання 3. Чи є запит покривним (covered query)?

```js
db.tracks.find({ track_genre: "pop", popularity: { $gte: 70 } });
```

Індекс із завдання 1: `{ track_genre: 1, popularity: -1, "audio_features.danceability": 1 }`.

**Відповідь: ні, у наведеному вигляді запит не є покривним.**

Покривним (covered) запит є тоді, коли виконуються **дві** умови одночасно:

1. усі поля **фільтра** входять до індексу;
2. усі поля, які запит **повертає**, також входять до того ж індексу — включно з `_id`,
   який треба явно виключити проєкцією, бо його в цьому індексі немає.

Тут виконана лише перша умова. `track_genre` — префікс індексу з умовою на рівність,
`popularity` — другий ключ з діапазоном; фільтр повністю обслуговується індексом.
Але **проєкції немає**, тому запит повертає цілі документи — з `track_name`, `artists`,
`album_name`, `audio_features` і `_id`. Жодного з цих полів (окрім двох ключів) в індексі
нема, тому MongoDB мусить після `IXSCAN` піти по вказівниках у колекцію і прочитати
документи — стадія **`FETCH`**.

Підтвердження з `explain()` — `totalDocsExamined` дорівнює `nReturned`, а не нулю:

```
--- find(...) без проєкції — повертаємо весь документ ---
winningPlan:            FETCH <- IXSCAN (genre_popularity_danceability)
nReturned:              317
totalKeysExamined:      317
totalDocsExamined:      317      <- документи читаються => НЕ covered
```

**Як зробити його покривним.** Достатньо обмежити проєкцію полями індексу й прибрати `_id`:

```js
db.tracks.find(
  { track_genre: "pop", popularity: { $gte: 70 } },
  { _id: 0, track_genre: 1, popularity: 1 }
);
```

```
--- проєкція в межах індексу ---
winningPlan:            PROJECTION_COVERED <- IXSCAN (genre_popularity_danceability)
nReturned:              317
totalKeysExamined:      317
totalDocsExamined:      0        <- документи не читаються => covered
```

Дві однозначні ознаки покривного запиту: стадія **`PROJECTION_COVERED`** замість `FETCH`
і **`totalDocsExamined: 0`**. Запит обслуговується повністю з B-tree індексу, не торкаючись
самих документів — а індекс значно компактніший за колекцію і з більшою ймовірністю
цілком лежить у RAM.

Покриття ламається від будь-якого поля поза індексом — навіть одного:

```
--- проєкція з полем поза індексом (track_name) ---
winningPlan:            PROJECTION_SIMPLE <- FETCH <- IXSCAN (genre_popularity_danceability)
nReturned:              317
totalKeysExamined:      317
totalDocsExamined:      317      <- FETCH повернувся
```

Так само покриття зникло б, якби не було `_id: 0`: `_id` повертається за замовчуванням,
а в індексі `genre_popularity_danceability` його немає.

Окремо варто зауважити: третє поле індексу, `audio_features.danceability`, у цьому запиті
не використовується ні у фільтрі, ні в проєкції — але воно й не шкодить покриттю.
Для covered query важливо, щоб поля запиту були **підмножиною** полів індексу,
а не щоб індекс точно їм відповідав.

### Індекси колекції після виконання скрипта

```js
[
  { v: 2, key: { _id: 1 }, name: '_id_' },
  { v: 2,
    key: { track_genre: 1, popularity: -1, 'audio_features.danceability': 1 },
    name: 'genre_popularity_danceability' },
  { v: 2,
    key: { explicit: 1, 'audio_features.instrumentalness': 1, 'audio_features.speechiness': 1 },
    name: 'focus_instrumentalness_speechiness_explicit' }
]
```

---

## Примітки щодо відтворюваності

- Усі числа в цьому README — з реальних запусків; повний вивід збережено в каталозі `outputs/`.
- `executionTimeMillis` залежить від стану кешу Atlas M0 і мережі; співвідношення
  `totalDocsExamined` / `nReturned` — стабільніша метрика для порівняння планів.
- `_id` у прикладах згенеровано під час `$out` і при повторному запуску `02_transform.js`
  буде іншим; `track_id` стабільний.
