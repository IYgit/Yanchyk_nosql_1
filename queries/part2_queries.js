// queries/part2_queries.js
// Частина 2 — запити до колекції spotify.tracks
// Запуск: mongosh MONGODB_URI --quiet --file queries/part2_queries.js

db = db.getSiblingDB("spotify");

function header(title) {
  print("\n" + "=".repeat(70));
  print(title);
  print("=".repeat(70));
}

// ============================================================================
// Завдання 1. Треки для вечірки
// danceability > 0.7, energy > 0.7, тривалість 3–5 хв (180000–300000 мс)
// ============================================================================
header("Завдання 1. Треки для вечірки");

const partyFilter = {
  "audio_features.danceability": { $gt: 0.7 },
  "audio_features.energy": { $gt: 0.7 },
  duration_ms: { $gte: 180000, $lte: 300000 }
};

const partyProjection = {
  _id: 0,
  track_name: 1,
  artists: 1,
  track_genre: 1,
  popularity: 1,
  duration_sec: 1,
  "audio_features.danceability": 1,
  "audio_features.energy": 1
};

print("Знайдено треків: " + db.tracks.countDocuments(partyFilter));
print("Топ-10 за популярністю:");
printjson(
  db.tracks
    .find(partyFilter, partyProjection)
    .sort({ popularity: -1 })
    .limit(10)
    .toArray()
);

// ============================================================================
// Завдання 2. Виконавці, у яких усі треки популярні
// >= 3 треки, мінімальна популярність треків >= 60
// ============================================================================
header("Завдання 2. Виконавці, у яких усі треки популярні (топ-20)");

const allPopularArtists = [
  // artists — масив, тому розгортаємо його: один документ на (трек, виконавець)
  { $unwind: "$artists" },
  {
    $group: {
      _id: "$artists",
      tracks_count: { $sum: 1 },
      min_popularity: { $min: "$popularity" },
      avg_popularity: { $avg: "$popularity" }
    }
  },
  // "усі треки популярні" == мінімум по групі не падає нижче 60
  {
    $match: {
      tracks_count: { $gte: 3 },
      min_popularity: { $gte: 60 }
    }
  },
  {
    $project: {
      _id: 0,
      artist: "$_id",
      tracks_count: 1,
      min_popularity: 1,
      avg_popularity: { $round: ["$avg_popularity", 1] }
    }
  },
  { $sort: { avg_popularity: -1, tracks_count: -1, artist: 1 } },
  { $limit: 20 }
];

printjson(db.tracks.aggregate(allPopularArtists).toArray());

// ============================================================================
// Завдання 3. Нетипові треки (аномально високий темп для свого жанру)
// tempo треку > mean(жанр) + 2 * stdDevPop(жанр)
// ============================================================================
header("Завдання 3. Нетипові треки за темпом (tempo > mean + 2*stdDev жанру)");

const tempoOutliers = [
  {
    $group: {
      _id: "$track_genre",
      avg_tempo: { $avg: "$audio_features.tempo" },
      std_tempo: { $stdDevPop: "$audio_features.tempo" },
      tracks: {
        $push: {
          _id: "$_id",
          track_name: "$track_name",
          popularity: "$popularity",
          artists: "$artists",
          audio_features: { tempo: "$audio_features.tempo" }
        }
      }
    }
  },
  {
    $addFields: {
      outlier_threshold: {
        $add: ["$avg_tempo", { $multiply: [2, "$std_tempo"] }]
      }
    }
  },
  {
    $project: {
      _id: 0,
      genre: "$_id",
      avg_tempo: { $round: ["$avg_tempo", 1] },
      outlier_threshold: { $round: ["$outlier_threshold", 1] },
      outlier_tracks: {
        $filter: {
          input: "$tracks",
          as: "t",
          cond: { $gt: ["$$t.audio_features.tempo", "$outlier_threshold"] }
        }
      }
    }
  },
  // жанри без аномалій у звіті не потрібні
  { $match: { "outlier_tracks.0": { $exists: true } } },
  { $sort: { genre: 1 } }
];

const outlierReport = db.tracks.aggregate(tempoOutliers).toArray();

print("Жанрів з нетиповими треками: " + outlierReport.length);
print(
  "Усього нетипових треків: " +
    outlierReport.reduce((acc, g) => acc + g.outlier_tracks.length, 0)
);

print("\nЗведення по жанрах (жанр | avg_tempo | порог | к-ть аномалій):");
outlierReport.forEach((g) => {
  print(
    "  " +
      g.genre.padEnd(20) +
      String(g.avg_tempo).padStart(7) +
      String(g.outlier_threshold).padStart(9) +
      String(g.outlier_tracks.length).padStart(6)
  );
});

print("\nПовна структура результату (приклад — перший жанр, перші 3 треки):");
const sampleGenre = Object.assign({}, outlierReport[0]);
sampleGenre.outlier_tracks = sampleGenre.outlier_tracks.slice(0, 3);
printjson(sampleGenre);

// ============================================================================
// Завдання 4. Треки для фонової роботи
// loudness < -10, speechiness < 0.1, instrumentalness > 0.5, без explicit
// ============================================================================
header("Завдання 4. Треки для фонової роботи");

const focusFilter = {
  "audio_features.loudness": { $lt: -10 },
  "audio_features.speechiness": { $lt: 0.1 },
  "audio_features.instrumentalness": { $gt: 0.5 },
  explicit: false
};

const focusProjection = {
  _id: 0,
  track_name: 1,
  artists: 1,
  track_genre: 1,
  popularity: 1,
  duration_sec: 1,
  "audio_features.loudness": 1,
  "audio_features.speechiness": 1,
  "audio_features.instrumentalness": 1
};

print("Знайдено треків: " + db.tracks.countDocuments(focusFilter));
print("Топ-10 за популярністю:");
printjson(
  db.tracks
    .find(focusFilter, focusProjection)
    .sort({ popularity: -1 })
    .limit(10)
    .toArray()
);

// ============================================================================
// Додатково. Багатоетапна агрегація з $lookup та $unwind
// Порівнюємо найпопулярніші треки із середніми показниками їхнього жанру.
// ============================================================================
header("Додатково. $lookup + $unwind: трек проти середнього по жанру");

const trackVsGenre = [
  { $match: { popularity_tier: "high" } },
  { $sort: { popularity: -1, track_name: 1 } },
  { $limit: 10 },
  {
    // корелюючий $lookup: для кожного треку рахуємо статистику його жанру
    $lookup: {
      from: "tracks",
      let: { genre: "$track_genre" },
      pipeline: [
        { $match: { $expr: { $eq: ["$track_genre", "$$genre"] } } },
        {
          $group: {
            _id: null,
            tracks_in_genre: { $sum: 1 },
            avg_energy: { $avg: "$audio_features.energy" },
            avg_popularity: { $avg: "$popularity" }
          }
        }
      ],
      as: "genre_stats"
    }
  },
  { $unwind: "$genre_stats" },
  {
    $project: {
      _id: 0,
      track_name: 1,
      artists: 1,
      track_genre: 1,
      popularity: 1,
      tracks_in_genre: "$genre_stats.tracks_in_genre",
      energy: "$audio_features.energy",
      genre_avg_energy: { $round: ["$genre_stats.avg_energy", 3] },
      genre_avg_popularity: { $round: ["$genre_stats.avg_popularity", 1] },
      energy_vs_genre: {
        $round: [
          { $subtract: ["$audio_features.energy", "$genre_stats.avg_energy"] },
          3
        ]
      }
    }
  }
];

printjson(db.tracks.aggregate(trackVsGenre).toArray());

print("\nГотово.");
