// queries/part3_indexes.js
// Частина 3 — індекси та оптимізація (додатковий блок, не оцінюється)
// Запуск: mongosh "ВАШ_URI" --quiet --file queries/part3_indexes.js
//
// Скрипт ідемпотентний: індекси, які він створює, спочатку скидаються,
// щоб "план без індексу" справді був планом без індексу.

db = db.getSiblingDB("spotify");

function header(title) {
  print("\n" + "=".repeat(70));
  print(title);
  print("=".repeat(70));
}

// dropIndex кидає помилку, якщо індексу немає — робимо виклик безпечним,
// щоб скрипт можна було запускати повторно.
function dropIndexIfExists(name) {
  try {
    db.tracks.dropIndex(name);
    print("(скинуто наявний індекс " + name + ")");
  } catch (e) {
    print("(індексу " + name + " не було — ок)");
  }
}

// Витягуємо з величезного виводу explain() лише те, що справді цікаво.
function stageTree(stage) {
  if (!stage) return "—";
  const parts = [stage.stage];
  if (stage.indexName) parts.push("(" + stage.indexName + ")");
  const child = stage.inputStage || (stage.inputStages && stage.inputStages[0]);
  return child ? parts.join(" ") + " <- " + stageTree(child) : parts.join(" ");
}

function summarizeExplain(label, explain) {
  const st = explain.executionStats;
  const win = explain.queryPlanner.winningPlan;
  print("\n--- " + label + " ---");
  print("winningPlan:            " + stageTree(win.queryPlan || win));
  print("nReturned:              " + st.nReturned);
  print("totalKeysExamined:      " + st.totalKeysExamined);
  print("totalDocsExamined:      " + st.totalDocsExamined);
  print("executionTimeMillis:    " + st.executionTimeMillis);
  const sortStage = JSON.stringify(win).includes('"SORT"');
  print("сортування в пам'яті:   " + (sortStage ? "так (стадія SORT)" : "ні"));
}

// ============================================================================
// Завдання 1. Аналіз запиту та індексація
// ============================================================================
header("Завдання 1. find({track_genre, danceability >= 0.7}).sort({popularity:-1})");

const q1Filter = {
  track_genre: "pop",
  "audio_features.danceability": { $gte: 0.7 }
};
const q1Sort = { popularity: -1 };

const IDX1 = "genre_popularity_danceability";

// 1.1 План ДО індексу
dropIndexIfExists(IDX1);

summarizeExplain(
  "ДО створення індексу",
  db.tracks.find(q1Filter).sort(q1Sort).explain("executionStats")
);

// 1.2 Створюємо складений індекс за правилом ESR:
//     Equality (track_genre) -> Sort (popularity) -> Range (danceability).
//     Такий порядок дає і точний збіг, і впорядкований обхід без стадії SORT.
print(
  "\nСтворюємо індекс: " +
    db.tracks.createIndex(
      { track_genre: 1, popularity: -1, "audio_features.danceability": 1 },
      { name: IDX1 }
    )
);

// 1.3 План ПІСЛЯ індексу
summarizeExplain(
  "ПІСЛЯ створення індексу",
  db.tracks.find(q1Filter).sort(q1Sort).explain("executionStats")
);

// Для порівняння: "наївний" порядок полів Equality -> Range -> Sort.
// Індекс використовується, але сортувати все одно доводиться в пам'яті.
const IDX1_NAIVE = "genre_danceability_popularity_naive";
dropIndexIfExists(IDX1_NAIVE);
db.tracks.createIndex(
  { track_genre: 1, "audio_features.danceability": 1, popularity: -1 },
  { name: IDX1_NAIVE }
);
summarizeExplain(
  "Для порівняння: hint на наївний порядок E->R->S",
  db.tracks.find(q1Filter).sort(q1Sort).hint(IDX1_NAIVE).explain("executionStats")
);
db.tracks.dropIndex(IDX1_NAIVE);

// ============================================================================
// Завдання 2. Складений індекс для пошуку музики для роботи
// ============================================================================
header("Завдання 2. Індекс по instrumentalness + speechiness + explicit");

const q2Filter = {
  "audio_features.instrumentalness": { $gt: 0.5 },
  "audio_features.speechiness": { $lt: 0.1 },
  explicit: false
};

const IDX2 = "focus_instrumentalness_speechiness_explicit";

dropIndexIfExists(IDX2);

summarizeExplain(
  "ДО створення індексу",
  db.tracks.find(q2Filter).explain("executionStats")
);

// explicit — рівність, тому за ESR він має стояти першим,
// а два діапазони — після нього.
print(
  "\nСтворюємо індекс: " +
    db.tracks.createIndex(
      {
        explicit: 1,
        "audio_features.instrumentalness": 1,
        "audio_features.speechiness": 1
      },
      { name: IDX2 }
    )
);

summarizeExplain(
  "ПІСЛЯ створення індексу",
  db.tracks.find(q2Filter).explain("executionStats")
);

// ============================================================================
// Завдання 3. Чи є запит покривним (covered query)?
// Індекс із завдання 1: { track_genre: 1, popularity: -1, audio_features.danceability: 1 }
// ============================================================================
header("Завдання 3. Covered query?");

const q3Filter = { track_genre: "pop", popularity: { $gte: 70 } };

summarizeExplain(
  "find(...) без проєкції — повертаємо весь документ",
  db.tracks.find(q3Filter).explain("executionStats")
);

summarizeExplain(
  "find(..., { _id: 0, track_genre: 1, popularity: 1 }) — проєкція в межах індексу",
  db.tracks
    .find(q3Filter, { _id: 0, track_genre: 1, popularity: 1 })
    .explain("executionStats")
);

summarizeExplain(
  "проєкція з полем поза індексом (track_name) — покриття ламається",
  db.tracks
    .find(q3Filter, { _id: 0, track_genre: 1, popularity: 1, track_name: 1 })
    .explain("executionStats")
);

// ============================================================================
header("Індекси колекції tracks після виконання скрипта");
printjson(db.tracks.getIndexes());

print("\nГотово.");
