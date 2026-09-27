"use strict";

var WCA_BASE = "https://raw.githubusercontent.com/robiningelbrecht/wca-rest-api/refs/heads/v1";
var WCA_SITE = "https://www.worldcubeassociation.org";
var currentKeyIndex = 0;
var sourceVersion = null;
var eventsCache = null;
var countriesCache = null;
var continentsCache = null;

var FALLBACK_EVENTS = {
  "222": "2x2x2 Cube",
  "333": "3x3x3 Cube",
  "444": "4x4x4 Cube",
  "555": "5x5x5 Cube",
  "666": "6x6x6 Cube",
  "777": "7x7x7 Cube",
  "333bf": "3x3x3 Blindfolded",
  "333fm": "3x3x3 Fewest Moves",
  "333oh": "3x3x3 One-Handed",
  "clock": "Clock",
  "minx": "Megaminx",
  "pyram": "Pyraminx",
  "skewb": "Skewb",
  "sq1": "Square-1",
  "444bf": "4x4x4 Blindfolded",
  "555bf": "5x5x5 Blindfolded",
  "333mbf": "3x3x3 Multi-Blind"
};

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function uniqueKeys(text) {
  var parts = String(text || "")
    .split(/[\n,;]+/)
    .map(function (x) { return x.trim(); })
    .filter(Boolean);

  return Array.from(new Set(parts));
}

function getKeys() {
  return uniqueKeys(document.getElementById("apiKeys").value);
}

function updateKeyCount() {
  var n = getKeys().length;
  document.getElementById("keyCount").textContent =
    n + (n === 1 ? " מפתח הוגדר" : " מפתחות הוגדרו");
}

function setStatus(message, type, loading) {
  var el = document.getElementById("status");
  el.className = "status" + (type ? " " + type : "");
  el.innerHTML = (loading ? '<span class="spinner"></span>' : "") + escapeHtml(message || "");
}

function setBusy(isBusy) {
  document.getElementById("askBtn").disabled = isBusy;
}

async function fetchJson(url, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 15000);

  try {
    var response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      var error = new Error("HTTP " + response.status + " עבור " + url);
      error.status = response.status;
      throw error;
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadReferenceData() {
  var results = await Promise.allSettled([
    fetchJson(WCA_BASE + "/version.json", 12000),
    fetchJson(WCA_BASE + "/events.json", 12000),
    fetchJson(WCA_BASE + "/countries.json", 12000),
    fetchJson(WCA_BASE + "/continents.json", 12000)
  ]);

  if (results[0].status === "fulfilled") {
    sourceVersion = results[0].value;
    var date = sourceVersion.export_date
      ? new Date(sourceVersion.export_date).toLocaleDateString("he-IL")
      : "לא ידוע";
    document.getElementById("sourceDate").textContent = "נתוני WCA: " + date;
  } else {
    document.getElementById("sourceDate").textContent = "נתוני WCA: תאריך לא זמין";
  }

  if (results[1].status === "fulfilled") eventsCache = results[1].value.items || [];
  if (results[2].status === "fulfilled") countriesCache = results[2].value.items || [];
  if (results[3].status === "fulfilled") continentsCache = results[3].value.items || [];
}

function eventName(eventId) {
  if (eventsCache) {
    var item = eventsCache.find(function (x) { return x.id === eventId; });
    if (item) return item.name;
  }

  return FALLBACK_EVENTS[eventId] || eventId;
}

function regionName(region) {
  if (region === "world") return "עולם";

  if (countriesCache) {
    var country = countriesCache.find(function (x) {
      return String(x.iso2Code || "").toUpperCase() === String(region).toUpperCase();
    });

    if (country) return country.name;
  }

  if (continentsCache) {
    var continent = continentsCache.find(function (x) { return x.id === region; });
    if (continent) return continent.name;
  }

  return region;
}

function getRankDimension(region) {
  if (region === "world") return "world";
  if (/^[A-Z]{2}$/.test(region)) return "country";
  return "continent";
}

function formatCentiseconds(value) {
  if (value === -1) return "DNF";
  if (value === -2) return "DNS";
  if (!value || value < 0) return "ללא תוצאה";

  var totalSeconds = value / 100;
  var hours = Math.floor(totalSeconds / 3600);
  var minutes = Math.floor((totalSeconds % 3600) / 60);
  var seconds = totalSeconds % 60;
  var secondsText = seconds.toFixed(2).padStart(5, "0");

  if (hours > 0) {
    return hours + ":" + String(minutes).padStart(2, "0") + ":" + secondsText;
  }

  if (minutes > 0) {
    return minutes + ":" + secondsText;
  }

  return seconds.toFixed(2);
}

function decodeMultiBlind(value) {
  var padded = String(value).padStart(10, "0");

  if (padded.charAt(0) === "1") {
    var solvedOld = 99 - Number(padded.slice(1, 3));
    var attemptedOld = Number(padded.slice(3, 5));
    var timeOld = Number(padded.slice(5, 10));

    return {
      solved: solvedOld,
      attempted: attemptedOld,
      seconds: timeOld
    };
  }

  var dd = Number(padded.slice(1, 3));
  var seconds = Number(padded.slice(3, 8));
  var missed = Number(padded.slice(8, 10));
  var difference = 99 - dd;
  var solved = difference + missed;

  return {
    solved: solved,
    attempted: solved + missed,
    seconds: seconds
  };
}

function formatSeconds(seconds) {
  if (seconds === 99999) return "זמן לא ידוע";

  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = seconds % 60;

  if (h > 0) {
    return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  return m + ":" + String(s).padStart(2, "0");
}

function formatResult(eventId, rankType, value) {
  if (eventId === "333fm") {
    if (rankType === "average") return (value / 100).toFixed(2) + " moves";
    return value + " moves";
  }

  if (eventId === "333mbf") {
    var multi = decodeMultiBlind(value);
    return multi.solved + "/" + multi.attempted + " ב-" + formatSeconds(multi.seconds);
  }

  return formatCentiseconds(value);
}

function normalizeIntent(intent) {
  var eventId = String(intent.eventId || intent.event || "").trim().toLowerCase();
  var rankType = String(intent.rankType || intent.type || "single").trim().toLowerCase();
  var region = String(intent.region || "world").trim();

  if (region.toLowerCase() === "world") {
    region = "world";
  } else if (/^[a-z]{2}$/i.test(region)) {
    region = region.toUpperCase();
  } else {
    region = region.toLowerCase().replace(/\s+/g, "-");
  }

  if (rankType !== "single" && rankType !== "average") rankType = "single";

  if (!/^[a-z0-9]+$/i.test(eventId)) {
    throw new Error("לא הצלחתי לזהות אירוע WCA תקין.");
  }

  if (!/^[a-z0-9-]+$/i.test(region)) {
    throw new Error("לא הצלחתי לזהות אזור WCA תקין.");
  }

  return {
    eventId: eventId,
    rankType: rankType,
    region: region
  };
}

function heuristicIntent(question) {
  var q = String(question || "").toLowerCase();
  var eventId = null;

  var aliases = [
    ["333mbf", ["multi blind", "multi-blind", "mbld", "מולטי בליינד", "מולטי עיוור"]],
    ["555bf", ["5x5 blind", "5x5 blindfolded", "555bf", "5x5 עיוור"]],
    ["444bf", ["4x4 blind", "4x4 blindfolded", "444bf", "4x4 עיוור"]],
    ["333bf", ["3x3 blind", "3x3 blindfolded", "333bf", "3x3 עיוור"]],
    ["333fm", ["fewest moves", "fmc", "333fm", "מעט מהלכים"]],
    ["333oh", ["one-handed", "one handed", "333oh", "יד אחת"]],
    ["clock", ["rubik's clock", "rubiks clock", "clock", "שעון"]],
    ["minx", ["megaminx", "מגמינקס"]],
    ["pyram", ["pyraminx", "פירמינקס"]],
    ["skewb", ["skewb", "סקיוב"]],
    ["sq1", ["square-1", "square 1", "sq1", "סקוור"]],
    ["777", ["7x7", "777"]],
    ["666", ["6x6", "666"]],
    ["555", ["5x5", "555"]],
    ["444", ["4x4", "444"]],
    ["333", ["3x3", "333", "קובייה הונגרית"]],
    ["222", ["2x2", "222"]]
  ];

  aliases.some(function (row) {
    if (row[1].some(function (alias) { return q.includes(alias); })) {
      eventId = row[0];
      return true;
    }

    return false;
  });

  var rankType = /average|\bavg\b|mean|ממוצע|ממוצעת|ao5|ao3/.test(q)
    ? "average"
    : "single";

  var region = "world";

  if (/ישראל|israel|\bil\b/.test(q)) region = "IL";
  else if (/אירופה|europe/.test(q)) region = "europe";
  else if (/אסיה|asia/.test(q)) region = "asia";
  else if (/אוקיאניה|oceania/.test(q)) region = "oceania";
  else if (/אפריקה|africa/.test(q)) region = "africa";
  else if (/צפון אמריקה|north america/.test(q)) region = "north-america";
  else if (/דרום אמריקה|south america/.test(q)) region = "south-america";

  if (!eventId) {
    throw new Error("לא הצלחתי לזהות את האירוע. נסה לכתוב למשל 3x3, 4x4, Pyraminx או Clock.");
  }

  return normalizeIntent({
    eventId: eventId,
    rankType: rankType,
    region: region
  });
}

function buildParserPrompt(question) {
  return [
    "You are a parser for WCA speedcubing record questions.",
    "Return ONLY valid JSON, with no markdown.",
    "Required keys: eventId, rankType, region.",
    "eventId must be one of: 222,333,444,555,666,777,333bf,333fm,333oh,clock,minx,pyram,skewb,sq1,444bf,555bf,333mbf.",
    "rankType must be single or average.",
    "region must be world, a two-letter WCA country code such as IL, US or PL, or one continent id: africa, asia, europe, north-america, oceania, south-america.",
    "Interpret both Hebrew and English.",
    "Examples:",
    "Hebrew Israel 2x2 record means eventId 222, rankType single, region IL.",
    "World record 4x4 average means eventId 444, rankType average, region world.",
    "Hebrew European 3x3 one-handed average means eventId 333oh, rankType average, region europe.",
    "Question: " + question
  ].join("\n");
}

async function geminiRequest(apiKey, model, prompt, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 18000);

  try {
    var url = "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model) + ":generateContent";

    var response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json"
        }
      })
    });

    var raw = await response.text();
    var data = null;

    try {
      data = JSON.parse(raw);
    } catch (_) {}

    if (!response.ok) {
      var msg = data && data.error && data.error.message
        ? data.error.message
        : raw || ("HTTP " + response.status);

      var err = new Error(msg);
      err.status = response.status;
      throw err;
    }

    var answerText = "";

    if (
      data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts
    ) {
      answerText = data.candidates[0].content.parts
        .map(function (part) { return part.text || ""; })
        .join("")
        .trim();
    }

    if (!answerText) throw new Error("Gemini לא החזיר תוכן.");

    var parsed;

    try {
      parsed = JSON.parse(answerText);
    } catch (_) {
      throw new Error("Gemini החזיר תשובה שאינה JSON תקין.");
    }

    return normalizeIntent(parsed);
  } finally {
    clearTimeout(timer);
  }
}

async function parseWithKeyFailover(question) {
  var keys = getKeys();
  var model = document.getElementById("model").value.trim() || "gemini-3.8-flash";

  if (!keys.length) {
    return {
      intent: heuristicIntent(question),
      mode: "heuristic",
      keyNumber: null
    };
  }

  var failures = [];
  var start = currentKeyIndex % keys.length;

  for (var offset = 0; offset < keys.length; offset++) {
    var index = (start + offset) % keys.length;

    setStatus(
      "Gemini: מנסה מפתח " + (index + 1) + " מתוך " + keys.length + "…",
      "",
      true
    );

    try {
      var intent = await geminiRequest(
        keys[index],
        model,
        buildParserPrompt(question),
        18000
      );

      currentKeyIndex = index;

      return {
        intent: intent,
        mode: "gemini",
        keyNumber: index + 1
      };
    } catch (error) {
      failures.push(
        "מפתח " + (index + 1) + ": " + (error.message || "שגיאה")
      );

      currentKeyIndex = (index + 1) % keys.length;
    }
  }

  try {
    return {
      intent: heuristicIntent(question),
      mode: "heuristic-after-failure",
      keyNumber: null,
      failures: failures
    };
  } catch (_) {
    var finalError = new Error(
      "כל מפתחות Gemini נכשלו ולא ניתן היה לפרש את השאלה ידנית."
    );

    finalError.details = failures;
    throw finalError;
  }
}

function findMatchingCompetitions(person, eventId, rankType, best) {
  var matches = [];
  var results = person && person.results ? person.results : {};

  Object.keys(results).forEach(function (competitionId) {
    var eventRounds = results[competitionId] && results[competitionId][eventId];

    if (!Array.isArray(eventRounds)) return;

    eventRounds.forEach(function (round) {
      var value = rankType === "average" ? round.average : round.best;

      if (value === best) {
        matches.push({
          competitionId: competitionId,
          round: round.round || "",
          position: round.position,
          format: round.format || ""
        });
      }
    });
  });

  return matches;
}

async function getRecordContext(rankItem, intent) {
  var personUrl =
    WCA_BASE + "/persons/" + encodeURIComponent(rankItem.personId) + ".json";

  var person = await fetchJson(personUrl, 15000);
  var matches = findMatchingCompetitions(
    person,
    intent.eventId,
    intent.rankType,
    rankItem.best
  );

  var competition = null;
  var match = null;

  if (matches.length) {
    var enriched = await Promise.all(
      matches.slice(0, 12).map(async function (m) {
        try {
          var data = await fetchJson(
            WCA_BASE + "/competitions/" +
              encodeURIComponent(m.competitionId) +
              ".json",
            12000
          );

          return {
            match: m,
            competition: data
          };
        } catch (_) {
          return {
            match: m,
            competition: null
          };
        }
      })
    );

    enriched.sort(function (a, b) {
      var ad =
        a.competition &&
        a.competition.date &&
        a.competition.date.from
          ? a.competition.date.from
          : "9999-99-99";

      var bd =
        b.competition &&
        b.competition.date &&
        b.competition.date.from
          ? b.competition.date.from
          : "9999-99-99";

      return ad.localeCompare(bd);
    });

    match = enriched[0].match;
    competition = enriched[0].competition;
  }

  return {
    rank: rankItem,
    person: person,
    match: match,
    competition: competition
  };
}

async function fetchRecord(intent) {
  var rankUrl =
    WCA_BASE + "/rank/" +
    encodeURIComponent(intent.region) + "/" +
    encodeURIComponent(intent.rankType) + "/" +
    encodeURIComponent(intent.eventId) +
    ".json";

  setStatus("שולף את דירוג ה-WCA…", "", true);

  var ranking;

  try {
    ranking = await fetchJson(rankUrl, 18000);
  } catch (error) {
    if (error.status === 404) {
      throw new Error(
        "לא קיים דירוג כזה ב-WCA. ייתכן שאין Average לאירוע שבחרת או שהאזור אינו תקין."
      );
    }

    throw error;
  }

  if (!ranking.items || !ranking.items.length) {
    throw new Error("לא נמצאו תוצאות לדירוג הזה.");
  }

  var dimension = getRankDimension(intent.region);
  var first = ranking.items[0];
  var best = first.best;

  var holders = ranking.items.filter(function (item) {
    return (
      item.best === best &&
      item.rank &&
      item.rank[dimension] === 1
    );
  });

  if (!holders.length) holders = [first];

  var contexts = await Promise.all(
    holders.slice(0, 8).map(function (item) {
      return getRecordContext(item, intent);
    })
  );

  return {
    intent: intent,
    ranking: ranking,
    holders: contexts,
    rankUrl: rankUrl
  };
}

function formatDate(dateString) {
  if (!dateString) return "";

  var date = new Date(dateString + "T00:00:00Z");

  if (isNaN(date.getTime())) return dateString;

  return date.toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function renderRecord(result, parseMeta) {
  var intent = result.intent;
  var best = result.holders[0].rank.best;
  var formatted = formatResult(intent.eventId, intent.rankType, best);
  var typeLabel = intent.rankType === "average" ? "Average" : "Single";
  var regionLabel = regionName(intent.region);
  var eventLabel = eventName(intent.eventId);

  var exportDate =
    sourceVersion && sourceVersion.export_date
      ? new Date(sourceVersion.export_date).toLocaleDateString("he-IL")
      : "לא ידוע";

  var holdersHtml = result.holders
    .map(function (ctx) {
      var person = ctx.person || {};
      var competition = ctx.competition;
      var match = ctx.match;

      var personLink =
        WCA_SITE + "/persons/" + encodeURIComponent(ctx.rank.personId);

      var details = "";

      if (competition) {
        var compLink =
          WCA_SITE + "/competitions/" + encodeURIComponent(competition.id);

        details +=
          '<p>תחרות: <a target="_blank" rel="noopener" href="' +
          escapeHtml(compLink) +
          '">' +
          escapeHtml(competition.name || competition.id) +
          "</a></p>";

        if (competition.date && competition.date.from) {
          details +=
            "<p>תאריך: " +
            escapeHtml(formatDate(competition.date.from)) +
            "</p>";
        }
      }

      if (match && match.round) {
        details += "<p>סיבוב: " + escapeHtml(match.round) + "</p>";
      }

      return [
        '<div class="holder">',
        "<h3>",
        '<a target="_blank" rel="noopener" href="',
        escapeHtml(personLink),
        '">',
        escapeHtml(person.name || ctx.rank.personId),
        "</a>",
        "</h3>",
        "<p>WCA ID: ",
        escapeHtml(ctx.rank.personId),
        person.country ? " · " + escapeHtml(person.country) : "",
        "</p>",
        details,
        "</div>"
      ].join("");
    })
    .join("");

  var modeText;

  if (parseMeta.mode === "gemini") {
    modeText =
      "השאלה פורשה באמצעות Gemini, מפתח " +
      parseMeta.keyNumber +
      ".";
  } else if (parseMeta.mode === "heuristic-after-failure") {
    modeText =
      "מפתחות Gemini לא החזירו תשובה; השאלה פורשה באמצעות מנגנון גיבוי מקומי.";
  } else {
    modeText = "השאלה פורשה באמצעות מנגנון מקומי.";
  }

  var html = [
    '<div class="record-head">',
    '<div class="record-value">',
    escapeHtml(formatted),
    "</div>",
    '<span class="badge">',
    escapeHtml(eventLabel),
    "</span>",
    '<span class="badge">',
    escapeHtml(typeLabel),
    "</span>",
    '<span class="badge">',
    escapeHtml(regionLabel),
    "</span>",
    "</div>",
    holdersHtml,
    '<div class="sources">',
    "<div>",
    escapeHtml(modeText),
    "</div>",
    "<div>מקור התוצאה: WCA Results Export דרך Unofficial WCA Public API. תאריך הייצוא: ",
    escapeHtml(exportDate),
    ".</div>",
    '<div><a target="_blank" rel="noopener" href="',
    escapeHtml(WCA_SITE + "/records"),
    '">רשומות WCA</a> · ',
    '<a target="_blank" rel="noopener" href="',
    escapeHtml(result.rankUrl),
    '">JSON של הדירוג</a></div>',
    "</div>"
  ].join("");

  document.getElementById("answer").innerHTML = html;
}

async function askAgent() {
  var question = document.getElementById("question").value.trim();

  if (!question) {
    setStatus("כתוב שאלה לפני הבדיקה.", "bad", false);
    return;
  }

  setBusy(true);

  document.getElementById("answer").innerHTML =
    '<div class="answer-empty"><span class="spinner"></span> בודק נתונים…</div>';

  try {
    var parsed = await parseWithKeyFailover(question);

    setStatus(
      "זוהה: " +
        eventName(parsed.intent.eventId) +
        " · " +
        (parsed.intent.rankType === "average" ? "Average" : "Single") +
        " · " +
        regionName(parsed.intent.region),
      "",
      true
    );

    var result = await fetchRecord(parsed.intent);

    renderRecord(result, parsed);

    if (parsed.mode === "heuristic-after-failure") {
      setStatus(
        "הנתון נשלף מה-WCA; Gemini נכשל ולכן הופעל Parser מקומי.",
        "warn",
        false
      );
    } else {
      setStatus("הבדיקה הושלמה.", "good", false);
    }
  } catch (error) {
    var extra =
      error.details && error.details.length
        ? "<br><br>" + escapeHtml(error.details.join(" | "))
        : "";

    document.getElementById("answer").innerHTML =
      '<div class="answer-empty"><strong>לא הצלחתי להשלים את הבדיקה.</strong><br>' +
      escapeHtml(error.message || String(error)) +
      extra +
      "</div>";

    setStatus(
      error.message || "אירעה שגיאה.",
      "bad",
      false
    );
  } finally {
    setBusy(false);
  }
}

function saveSettings() {
  var remember = document.getElementById("rememberKeys").checked;
  var model = document.getElementById("model").value.trim();

  localStorage.setItem("cubingAgentModel", model);

  if (remember) {
    localStorage.setItem(
      "cubingAgentKeys",
      document.getElementById("apiKeys").value
    );
    localStorage.setItem("cubingAgentRememberKeys", "1");
  } else {
    localStorage.removeItem("cubingAgentKeys");
    localStorage.removeItem("cubingAgentRememberKeys");
  }

  updateKeyCount();
  setStatus("ההגדרות נשמרו בדפדפן.", "good", false);
}

function loadSettings() {
  var model = localStorage.getItem("cubingAgentModel");
  var remember =
    localStorage.getItem("cubingAgentRememberKeys") === "1";

  if (model) {
    document.getElementById("model").value = model;
  }

  document.getElementById("rememberKeys").checked = remember;

  if (remember) {
    document.getElementById("apiKeys").value =
      localStorage.getItem("cubingAgentKeys") || "";
  }

  updateKeyCount();
}

document
  .getElementById("apiKeys")
  .addEventListener("input", updateKeyCount);

document
  .getElementById("askBtn")
  .addEventListener("click", askAgent);

document
  .getElementById("saveSettings")
  .addEventListener("click", saveSettings);

document
  .getElementById("question")
  .addEventListener("keydown", function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      askAgent();
    }
  });

document.querySelectorAll(".chip").forEach(function (button) {
  button.addEventListener("click", function () {
    document.getElementById("question").value =
      button.getAttribute("data-q") || "";

    document.getElementById("question").focus();
  });
});

loadSettings();

loadReferenceData().catch(function () {
  document.getElementById("sourceDate").textContent =
    "נתוני WCA: לא זמין";
});
