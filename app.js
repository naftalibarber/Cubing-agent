"use strict";

var WCA_BASE = "https://raw.githubusercontent.com/robiningelbrecht/wca-rest-api/refs/heads/v1";
var WCA_SITE = "https://www.worldcubeassociation.org";
var currentKeyIndex = 0;
var sourceVersion = null;
var eventsCache = null;
var countriesCache = null;
var continentsCache = null;
var keyCooldownUntil = Object.create(null);

var GEMINI_TIMEOUT_MS = 7000;
var KEY_COOLDOWN_MS = 5 * 60 * 1000;
var MAX_RECORDS_PER_QUERY = 20;

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

function normalizeIntents(payload) {
  var raw = Array.isArray(payload)
    ? payload
    : payload && Array.isArray(payload.intents)
      ? payload.intents
      : [payload];

  var out = [];
  var seen = Object.create(null);

  raw.forEach(function (item) {
    if (!item) return;

    try {
      var normalized = normalizeIntent(item);
      var key =
        normalized.eventId + "|" +
        normalized.rankType + "|" +
        normalized.region;

      if (!seen[key]) {
        seen[key] = true;
        out.push(normalized);
      }
    } catch (_) {}
  });

  if (!out.length) {
    throw new Error("לא הצלחתי לזהות אף שיא תקין.");
  }

  return out.slice(0, MAX_RECORDS_PER_QUERY);
}

function containsAny(text, aliases) {
  return aliases.some(function (alias) {
    return text.includes(alias);
  });
}

function removeAliases(text, aliases) {
  var out = text;

  aliases.forEach(function (alias) {
    out = out.split(alias).join(" ");
  });

  return out;
}

function findAliasMatches(text, eventId, aliases, priority) {
  var matches = [];

  aliases.forEach(function (alias) {
    var start = 0;

    while (true) {
      var index = text.indexOf(alias, start);
      if (index < 0) break;

      matches.push({
        eventId: eventId,
        index: index,
        end: index + alias.length,
        priority: priority
      });

      start = index + Math.max(alias.length, 1);
    }
  });

  return matches;
}

function extractEventIds(question) {
  var text = String(question || "").toLowerCase();

  var specialized = [
    ["333mbf", ["3x3 multi blind", "3x3 multi-blind", "3x3 מולטי בליינד", "3x3 מולטי עיוור", "multi blind", "multi-blind", "mbld", "מולטי בליינד", "מולטי עיוור"]],
    ["555bf", ["5x5 blind", "5x5 blindfolded", "555bf", "5x5 עיוור"]],
    ["444bf", ["4x4 blind", "4x4 blindfolded", "444bf", "4x4 עיוור"]],
    ["333bf", ["3x3 blind", "3x3 blindfolded", "333bf", "3x3 עיוור"]],
    ["333fm", ["3x3 fewest moves", "3x3 fmc", "3x3 מעט מהלכים", "fewest moves", "fmc", "333fm", "מעט מהלכים"]],
    ["333oh", ["3x3 one-handed", "3x3 one handed", "3x3 ביד אחת", "3x3 יד אחת", "one-handed", "one handed", "333oh", "יד אחת"]],
    ["clock", ["rubik's clock", "rubiks clock", "clock", "שעון"]],
    ["minx", ["megaminx", "מגמינקס"]],
    ["pyram", ["pyraminx", "פירמינקס"]],
    ["skewb", ["skewb", "סקיוב"]],
    ["sq1", ["square-1", "square 1", "sq1", "סקוור"]]
  ];

  var standard = [
    ["777", ["7x7", "7×7", "777"]],
    ["666", ["6x6", "6×6", "666"]],
    ["555", ["5x5", "5×5", "555"]],
    ["444", ["4x4", "4×4", "444"]],
    ["333", ["3x3", "3×3", "333", "קובייה הונגרית"]],
    ["222", ["2x2", "2×2", "222"]]
  ];

  var specializedMatches = [];

  specialized.forEach(function (row) {
    specializedMatches = specializedMatches.concat(
      findAliasMatches(text, row[0], row[1], 0)
    );
  });

  var allMatches = specializedMatches.slice();

  standard.forEach(function (row) {
    var matches = findAliasMatches(text, row[0], row[1], 1);

    matches.forEach(function (match) {
      var overlapsSpecialized = specializedMatches.some(function (special) {
        return (
          match.index < special.end &&
          match.end > special.index
        );
      });

      if (!overlapsSpecialized) {
        allMatches.push(match);
      }
    });
  });

  allMatches.sort(function (a, b) {
    if (a.index !== b.index) return a.index - b.index;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return (b.end - b.index) - (a.end - a.index);
  });

  var seen = Object.create(null);
  var found = [];

  allMatches.forEach(function (match) {
    if (!seen[match.eventId]) {
      seen[match.eventId] = true;
      found.push(match.eventId);
    }
  });

  return found;
}

function extractRankTypes(question) {
  var q = String(question || "").toLowerCase();
  var types = [];

  if (/single|סינגל|בודד|יחיד/.test(q)) {
    types.push("single");
  }

  if (/average|\bavg\b|mean|ממוצע|ממוצעת|ao5|ao3/.test(q)) {
    types.push("average");
  }

  if (!types.length) {
    types.push("single");
  }

  return types;
}

function extractRegions(question) {
  var q = String(question || "").toLowerCase();
  var regions = [];

  if (/ישראל|israel|\bil\b/.test(q)) regions.push("IL");
  if (/אירופה|europe/.test(q)) regions.push("europe");
  if (/אסיה|asia/.test(q)) regions.push("asia");
  if (/אוקיאניה|oceania/.test(q)) regions.push("oceania");
  if (/אפריקה|africa/.test(q)) regions.push("africa");
  if (/צפון אמריקה|north america/.test(q)) regions.push("north-america");
  if (/דרום אמריקה|south america/.test(q)) regions.push("south-america");
  if (/שיא עולם|שיאי עולם|world record|\bwr\b|עולמי|עולמיים/.test(q)) regions.push("world");

  if (!regions.length) {
    regions.push("world");
  }

  return Array.from(new Set(regions));
}

function heuristicIntentsDetailed(question) {
  var events = extractEventIds(question);

  if (!events.length) {
    throw new Error(
      "לא הצלחתי לזהות את האירוע. נסה לכתוב למשל 2x2, 3x3, 4x4, Pyraminx או Clock."
    );
  }

  var types = extractRankTypes(question);
  var regions = extractRegions(question);
  var intents = [];

  regions.forEach(function (region) {
    types.forEach(function (rankType) {
      events.forEach(function (eventId) {
        intents.push(
          normalizeIntent({
            eventId: eventId,
            rankType: rankType,
            region: region
          })
        );
      });
    });
  });

  var confident = true;

  if (events.length > 1 && regions.length > 1) confident = false;
  if (events.length > 1 && types.length > 1) confident = false;

  return {
    intents: normalizeIntents(intents),
    confident: confident
  };
}

function heuristicIntents(question) {
  return heuristicIntentsDetailed(question).intents;
}

function buildParserPrompt(question) {
  return [
    "You parse WCA speedcubing record requests.",
    "Return ONLY valid JSON with this exact shape: {\"intents\":[...]}",
    "Each intent must have eventId, rankType, region.",
    "The user may ask for several records in one request. Return one intent for every requested record.",
    "eventId must be one of: 222,333,444,555,666,777,333bf,333fm,333oh,clock,minx,pyram,skewb,sq1,444bf,555bf,333mbf.",
    "rankType must be single or average.",
    "region must be world, a two-letter WCA country code such as IL, US or PL, or one continent id: africa, asia, europe, north-america, oceania, south-america.",
    "Interpret Hebrew and English.",
    "Do not answer the question and do not invent record values. Only parse the requested records.",
    "Maximum " + MAX_RECORDS_PER_QUERY + " intents.",
    "Example: world records for 2x2, 3x3 and 4x4 single => {\"intents\":[{\"eventId\":\"222\",\"rankType\":\"single\",\"region\":\"world\"},{\"eventId\":\"333\",\"rankType\":\"single\",\"region\":\"world\"},{\"eventId\":\"444\",\"rankType\":\"single\",\"region\":\"world\"}]}",
    "Question: " + question
  ].join("\n");
}

function buildContinuationPrompt(originalPrompt, partialText) {
  var partial = String(partialText || "").slice(-8000);

  return [
    originalPrompt,
    "",
    "IMPORTANT CONTINUATION:",
    "A previous API key started the response but was interrupted.",
    "Here is the partial output already produced:",
    partial,
    "",
    "Continue the SAME task using the partial output as progress.",
    "Return one COMPLETE valid JSON object in the required schema.",
    "Preserve any valid intents already present, finish missing ones, remove duplicates, and repair truncated JSON.",
    "Do not explain what happened and do not restart the task conceptually from zero."
  ].join("\n");
}

function extractTextFromStreamPayload(payload) {
  if (
    !payload ||
    !payload.candidates ||
    !payload.candidates[0] ||
    !payload.candidates[0].content ||
    !payload.candidates[0].content.parts
  ) {
    return "";
  }

  return payload.candidates[0].content.parts
    .map(function (part) {
      return part.text || "";
    })
    .join("");
}

function parseSseEvent(eventText) {
  var dataLines = String(eventText || "")
    .split(/\r?\n/)
    .filter(function (line) {
      return line.startsWith("data:");
    })
    .map(function (line) {
      return line.slice(5).trimStart();
    });

  if (!dataLines.length) return null;

  var dataText = dataLines.join("\n").trim();

  if (!dataText || dataText === "[DONE]") return null;

  try {
    return JSON.parse(dataText);
  } catch (_) {
    return null;
  }
}

async function geminiRequest(apiKey, model, prompt, timeoutMs, partialFromPreviousKey) {
  var controller = new AbortController();
  var timer = setTimeout(function () {
    controller.abort();
  }, timeoutMs || 18000);

  var answerText = "";
  var effectivePrompt = partialFromPreviousKey
    ? buildContinuationPrompt(prompt, partialFromPreviousKey)
    : prompt;

  try {
    var url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model) +
      ":streamGenerateContent?alt=sse";

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
          parts: [{ text: effectivePrompt }]
        }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          thinkingConfig: {
            thinkingLevel: "low"
          }
        }
      })
    });

    if (!response.ok) {
      var rawError = await response.text();
      var data = null;

      try {
        data = JSON.parse(rawError);
      } catch (_) {}

      var msg =
        data && data.error && data.error.message
          ? data.error.message
          : rawError || ("HTTP " + response.status);

      var httpError = new Error(msg);
      httpError.status = response.status;
      httpError.partialText = answerText;
      throw httpError;
    }

    if (!response.body || !response.body.getReader) {
      var fullText = await response.text();
      var fallbackEvents = fullText.split(/\r?\n\r?\n/);

      fallbackEvents.forEach(function (eventText) {
        var payload = parseSseEvent(eventText);
        if (payload) answerText += extractTextFromStreamPayload(payload);
      });
    } else {
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";

      while (true) {
        var readResult = await reader.read();

        if (readResult.done) break;

        buffer += decoder.decode(readResult.value, { stream: true });

        var events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || "";

        events.forEach(function (eventText) {
          var payload = parseSseEvent(eventText);

          if (payload) {
            answerText += extractTextFromStreamPayload(payload);
          }
        });
      }

      buffer += decoder.decode();

      if (buffer.trim()) {
        var lastPayload = parseSseEvent(buffer);
        if (lastPayload) answerText += extractTextFromStreamPayload(lastPayload);
      }
    }

    answerText = answerText.trim();

    if (!answerText) {
      var emptyError = new Error("Gemini לא החזיר תוכן.");
      emptyError.partialText = "";
      throw emptyError;
    }

    var parsed;

    try {
      parsed = JSON.parse(answerText);
    } catch (_) {
      var jsonError = new Error("Gemini נקטע לפני שהחזיר JSON מלא.");
      jsonError.partialText = answerText;
      throw jsonError;
    }

    return {
      intents: normalizeIntents(parsed),
      rawText: answerText
    };
  } catch (error) {
    if (!error.partialText) {
      error.partialText = answerText;
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function markKeyCooldown(apiKey) {
  keyCooldownUntil[apiKey] = Date.now() + KEY_COOLDOWN_MS;
}

function isKeyCoolingDown(apiKey) {
  return (keyCooldownUntil[apiKey] || 0) > Date.now();
}

async function parseWithKeyFailover(question) {
  var local = null;

  try {
    local = heuristicIntentsDetailed(question);

    if (local.confident) {
      return {
        intents: local.intents,
        mode: "heuristic",
        keyNumber: null
      };
    }
  } catch (_) {}

  var keys = getKeys();
  var model = document.getElementById("model").value.trim() || "gemini-3.8-flash";

  if (!keys.length) {
    if (local && local.intents.length) {
      return {
        intents: local.intents,
        mode: "heuristic-ambiguous",
        keyNumber: null
      };
    }

    throw new Error("לא הצלחתי לפרש את הבקשה, ואין מפתח Gemini זמין.");
  }

  var candidates = [];
  var start = currentKeyIndex % keys.length;

  for (var offset = 0; offset < keys.length; offset++) {
    var index = (start + offset) % keys.length;
    var apiKey = keys[index];

    if (!isKeyCoolingDown(apiKey)) {
      candidates.push({
        index: index,
        apiKey: apiKey
      });
    }
  }

  if (!candidates.length) {
    if (local && local.intents.length) {
      return {
        intents: local.intents,
        mode: "heuristic-cooldown",
        keyNumber: null
      };
    }

    throw new Error("כל מפתחות Gemini נמצאים כרגע בהשהיה לאחר כשל קודם.");
  }


  var failures = [];
  var carriedPartial = "";
  var parserPrompt = buildParserPrompt(question);
  var totalCandidates = candidates.length;

  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];
    var continuing = carriedPartial.length > 0;

    setStatus(
      continuing
        ? "Gemini: מפתח " +
            (candidate.index + 1) +
            " ממשיך מהתשובה החלקית של המפתח הקודם…"
        : "Gemini: מנסה מפתח " +
            (candidate.index + 1) +
            " · מפתח " +
            (i + 1) +
            " מתוך " +
            totalCandidates +
            "…",
      "",
      true
    );

    try {
      var result = await geminiRequest(
        candidate.apiKey,
        model,
        parserPrompt,
        GEMINI_TIMEOUT_MS,
        carriedPartial
      );

      currentKeyIndex = candidate.index;

      return {
        intents: result.intents,
        mode: continuing ? "gemini-continuation" : "gemini",
        keyNumber: candidate.index + 1,
        continuedFromPreviousKey: continuing
      };
    } catch (error) {
      markKeyCooldown(candidate.apiKey);

      if (error.partialText && error.partialText.trim()) {
        carriedPartial = error.partialText.trim();

        setStatus(
          "מפתח " +
            (candidate.index + 1) +
            " נקטע אחרי שהחזיר חלק מהתשובה. שומר את ההתקדמות ומעביר למפתח הבא…",
          "warn",
          true
        );
      }

      failures.push(
        "מפתח " +
          (candidate.index + 1) +
          ": " +
          (error && error.name === "AbortError"
            ? "חרג מזמן ההמתנה"
            : (error.message || "שגיאה"))
      );

      currentKeyIndex = (candidate.index + 1) % keys.length;
    }
  }

  if (local && local.intents.length) {
    return {
      intents: local.intents,
      mode: carriedPartial
        ? "heuristic-after-partial-failure"
        : "heuristic-after-failure",
      keyNumber: null,
      failures: failures,
      partialPreserved: carriedPartial
    };
  }

  var finalError = new Error(
    carriedPartial
      ? "Gemini התחיל תשובה וההתקדמות הועברה למפתח הבא, אבל גם המפתח הבא לא הצליח להשלים אותה."
      : "Gemini לא סיים גם אחרי שנוסו כל " +
          candidates.length +
          " המפתחות הזמינים פעם אחת."
  );

  finalError.details = failures;
  finalError.partialText = carriedPartial;
  throw finalError;
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

function renderRecordCard(result) {
  var intent = result.intent;
  var best = result.holders[0].rank.best;
  var formatted = formatResult(intent.eventId, intent.rankType, best);
  var typeLabel = intent.rankType === "average" ? "Average" : "Single";
  var regionLabel = regionName(intent.region);
  var eventLabel = eventName(intent.eventId);

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

  return [
    '<section class="record-card">',
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
    '<a target="_blank" rel="noopener" href="',
    escapeHtml(result.rankUrl),
    '">JSON של הדירוג</a>',
    "</div>",
    "</section>"
  ].join("");
}

function renderRecords(results, parseMeta) {
  var exportDate =
    sourceVersion && sourceVersion.export_date
      ? new Date(sourceVersion.export_date).toLocaleDateString("he-IL")
      : "לא ידוע";

  var modeText;

  if (parseMeta.mode === "gemini-continuation") {
    modeText =
      "מפתח Gemini קודם נקטע באמצע; ההתקדמות שלו הועברה למפתח " +
      parseMeta.keyNumber +
      ", שהשלים את אותה בקשה.";
  } else if (parseMeta.mode === "gemini") {
    modeText =
      "הבקשה פורשה באמצעות Gemini, מפתח " +
      parseMeta.keyNumber +
      ".";
  } else if (parseMeta.mode === "heuristic-after-failure") {
    modeText =
      "Gemini לא סיים בזמן; הבקשה הושלמה באמצעות המפרש המקומי.";
  } else if (parseMeta.mode === "heuristic-ambiguous") {
    modeText =
      "הבקשה פורשה מקומית ללא Gemini; בבקשה מורכבת ייתכן שכדאי לנסח כל קבוצה בנפרד.";
  } else {
    modeText =
      "הבקשה זוהתה מקומית ולכן לא היה צורך לקרוא ל-Gemini.";
  }

  var cards = results.map(renderRecordCard).join("");

  document.getElementById("answer").innerHTML = [
    '<div class="multi-summary">',
    "<strong>",
    escapeHtml(results.length),
    " שיאים נמצאו</strong>",
    "<div>",
    escapeHtml(modeText),
    "</div>",
    "<div>מקור: WCA Results Export. תאריך הייצוא: ",
    escapeHtml(exportDate),
    ".</div>",
    "</div>",
    '<div class="record-list">',
    cards,
    "</div>"
  ].join("");
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
    var intents = parsed.intents;

    setStatus(
      "זוהו " + intents.length + " שיאים. שולף נתוני WCA…",
      "",
      true
    );

    var settled = await Promise.allSettled(
      intents.map(function (intent) {
        return fetchRecord(intent);
      })
    );

    var results = [];
    var errors = [];

    settled.forEach(function (item, index) {
      if (item.status === "fulfilled") {
        results.push(item.value);
      } else {
        errors.push({
          intent: intents[index],
          error: item.reason
        });
      }
    });

    if (!results.length) {
      throw new Error(
        errors.length
          ? errors[0].error.message
          : "לא נמצאו תוצאות."
      );
    }

    renderRecords(results, parsed);

    if (errors.length) {
      setStatus(
        results.length +
          " שיאים הוצגו, ו-" +
          errors.length +
          " בקשות לא היו זמינות.",
        "warn",
        false
      );
    } else if (
      parsed.mode === "heuristic-after-failure" ||
      parsed.mode === "heuristic-after-partial-failure" ||
      parsed.mode === "heuristic-cooldown"
    ) {
      setStatus(
        "הבדיקה הושלמה בלי להמשיך בין מפתחות Gemini תקועים.",
        "warn",
        false
      );
    } else {
      setStatus(
        "הבדיקה הושלמה: " + results.length + " שיאים.",
        "good",
        false
      );
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
