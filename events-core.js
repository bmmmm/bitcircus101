/**
 * events-core.js — shared card-shaping logic used by BOTH the Node sync script
 * (scripts/sync-events.mjs) and the browser pages (events.js, main.js, kiosk.js).
 *
 * Single source of truth for tags, event type and the card object itself: edit
 * here and every consumer updates. Parsing stays in ics-core.js; this module
 * only maps parsed ICS events onto card objects.
 *
 * Written in ES5 so the browser build needs no transpilation. The key insertion
 * order of toCard() is load-bearing: it is the JSON.stringify order in
 * events-data.json (pinned by the golden test in tests/sync-events.spec.mjs).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.EventsCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  /** Skip internal/blocker events */
  function isInternal(summary) {
    var s = summary.toLowerCase();
    return s.indexOf("blocker") !== -1 || s.indexOf("interne veranstaltung") !== -1;
  }

  function guessType(summary) {
    var s = summary.toLowerCase();
    if (s.indexOf("linkup") !== -1) return "linkup";
    if (s.indexOf("workshop") !== -1 || s.indexOf("löten") !== -1 ||
        s.indexOf("hands-on") !== -1) return "workshop";
    return "special";
  }

  /**
   * The owner's cancellation marker: a title that STARTS with CANCELED,
   * CANCELLED or ABGESAGT (any case, an optional bracket before it), e.g.
   * "CANCELED: Linkup" or "[Abgesagt] Lötabend". A prefix, not a word search —
   * "Linkup – nicht abgesagt" must not match. Renaming instead of deleting is
   * the one signal that survives a deletion after the date: the export relists
   * history, so the archive, the event page, the feeds and /status all agree.
   */
  var CANCEL_TITLE_RE = /^\s*[\[(]?\s*(cancell?ed|abgesagt)\b/i;
  function isCancelledTitle(summary) {
    return typeof summary === "string" && CANCEL_TITLE_RE.test(summary);
  }

  /**
   * The title without the owner's marker — for display only. The data keeps
   * the raw title: the ids of UID-less sources, mergeArchive, the RSS titles
   * and eventAnchor all read it. The marker, its bracket and one separator
   * (":", "-", "–", "—", "|") go; a title that is nothing but the marker
   * stays as it is rather than turning into an empty string.
   */
  var CANCEL_PREFIX_RE = /^\s*[\[(]?\s*(cancell?ed|abgesagt)\b\s*[\])]?\s*[:\-–—|]?\s*/i;
  function stripCancelMarker(summary) {
    if (typeof summary !== "string") return summary;
    var out = summary.replace(CANCEL_PREFIX_RE, "");
    return out || summary;
  }

  /**
   * Tag resolution — 3 sources, in priority:
   *
   * 1. Explicit #hashtags in the event description  (you control these in the calendar entry)
   * 2. ICS CATEGORIES field                         (the calendar entry's categories)
   * 3. Keyword auto-detection from title/description (fallback)
   *
   * → Write "#workshop #hardware" anywhere in the calendar entry's description
   *   and those tags appear on the website. No code changes needed.
   */
  function extractHashtags(text) {
    var matches = text.match(/#[a-zA-Z0-9äöüß_-]+/g);
    return matches
      ? matches.map(function (t) { return t.toLowerCase(); })
      : [];
  }

  function keywordTags(text) {
    var tags = [];
    // Event format
    if (text.indexOf("linkup") !== -1 || text.indexOf("casual") !== -1) tags.push("#meetup");
    if (text.indexOf("lightning") !== -1) tags.push("#lightning-talks");
    if (text.indexOf("workshop") !== -1) tags.push("#workshop");
    if (text.indexOf("vortrag") !== -1 || text.indexOf("talk") !== -1) tags.push("#talk");
    // Topics
    if (text.indexOf("hardware") !== -1 || text.indexOf("löten") !== -1 || text.indexOf("soldering") !== -1) tags.push("#hardware");
    if (text.indexOf("ctf") !== -1 || text.indexOf("capture the flag") !== -1) tags.push("#ctf");
    if (/\bsecurity\b/.test(text) || /\bpentest\b/.test(text)) tags.push("#security");
    if (/\bllm\b/.test(text) || /\b(ai|künstliche intelligenz)\b/.test(text)) tags.push("#ai");
    if (text.indexOf("retro") !== -1 || /\bgaming\b/.test(text) || text.indexOf("spieleabend") !== -1) tags.push("#gaming");
    if (text.indexOf("fsfe") !== -1 || text.indexOf("open source") !== -1 || text.indexOf("free software") !== -1) tags.push("#foss");
    if (/\bchaos\b/.test(text) || /\bccc\b/.test(text) || text.indexOf("easterhegg") !== -1 || text.indexOf("congress") !== -1) tags.push("#chaos");
    if (/\bfroscon\b/i.test(text) || text.indexOf("free and open source") !== -1) tags.push("#froscon");
    if (text.indexOf("nixos") !== -1 || text.indexOf("linux") !== -1 || text.indexOf("kernel") !== -1) tags.push("#linux");
    if (text.indexOf("3d") !== -1 || text.indexOf("druck") !== -1 || text.indexOf("print") !== -1) tags.push("#3d");
    // Community / venue
    if (text.indexOf("datenburg") !== -1) tags.push("#datenburg");
    if (text.indexOf("offen") !== -1 || text.indexOf("tag des offenen") !== -1) tags.push("#offener-abend");
    if (text.indexOf("spielen") !== -1 || text.indexOf("puzzeln") !== -1 || text.indexOf("toys") !== -1) tags.push("#spieletreff");
    return tags;
  }

  function buildTags(summary, description, categories, calTags) {
    calTags = calTags || [];

    // 1. Explicit hashtags from description
    var explicit = extractHashtags(description);

    // 2. ICS CATEGORIES
    var catTags = categories
      ? categories.split(",").map(function (c) {
          return "#" + c.trim().toLowerCase().replace(/\s+/g, "-");
        })
      : [];

    // 3. Keyword fallback
    var text = (summary + " " + description).toLowerCase();
    var auto = keywordTags(text);

    // Merge, deduplicate, keep order. cal.tags first so source-pinned tags always
    // survive. Object.create(null) instead of {} so tag names can never collide
    // with Object.prototype keys ("#constructor").
    var seen = Object.create(null);
    var merged = [];
    var all = calTags.concat(explicit, catTags, auto);
    for (var i = 0; i < all.length; i++) {
      var n = all[i].toLowerCase();
      if (!seen[n]) { seen[n] = true; merged.push(all[i]); }
    }
    return merged.length ? merged : ["#community"];
  }

  /** Clean up ICS location — normalize whitespace, strip redundant parts */
  function cleanLocation(loc) {
    if (!loc) return "";
    // Replace \n with ", ", collapse whitespace
    var s = loc.replace(/\\n/gi, ", ").replace(/\s+/g, " ").trim();
    // Remove trailing ", Germany" / ", Deutschland"
    s = s.replace(/,\s*(Germany|Deutschland)\s*$/i, "");
    // Remove leading "bitcircus101" if followed by address
    s = s.replace(/^bitcircus101[,\s]*/i, "");
    return s.trim();
  }

  /**
   * Truncate a description to ~max chars at a word boundary — the card teaser on
   * /events and the <meta description> of an event page. Cards themselves carry
   * the full text since the detail pages exist; consumers shorten, the data doesn't.
   */
  function truncateDesc(s, max) {
    if (max == null) max = 200;
    if (!s || s.length <= max) return s;
    var cut = s.slice(0, max);
    var last = cut.lastIndexOf(" ");
    return (last > 0 ? cut.slice(0, last) : cut) + " …";
  }

  /**
   * Display helper: drop trailing lines that are nothing but #hashtags (the tag
   * source, see buildTags) so the tags don't show twice — once as chips, once as
   * a stray last paragraph. Data stays untouched; only renderers call this.
   */
  function stripTagLines(s) {
    if (!s) return "";
    var lines = s.split("\n");
    while (lines.length && /^\s*(#[a-zA-Z0-9äöüÄÖÜß_-]+\s*)+$/.test(lines[lines.length - 1])) {
      lines.pop();
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines.join("\n");
  }

  /** FNV-1a 32-bit over the UTF-16 code units — plain ES5, no crypto, same in Node and browser. */
  function fnv1a32(str, offsetBasis) {
    var h = offsetBasis >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      // h * 16777619 mod 2^32 without float drift
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("00000000" + h.toString(16)).slice(-8);
  }

  /**
   * Stable, reproducible per-occurrence id — the path of the event page (/e/<id>/).
   * Keyed so that a one-off keeps its URL when it is moved (uid only), every
   * occurrence of a series gets its own (uid + date), and a source without UIDs
   * still gets a deterministic id from what identifies the occurrence for humans.
   * Two FNV-1a lanes → 12 lowercase hex chars (~48 bits): a collision is a dead
   * permanent URL, so 32 bits alone were too thin for an append-only archive.
   * Derived, not registered on purpose: a lost events-archive.json must never
   * change a single URL.
   */
  function eventId(e, cal) {
    var key;
    if (e.uid) {
      key = e.recurring ? e.uid + "|" + e.date : e.uid;
    } else {
      var title = (e.title || "").toLowerCase().replace(/\s+/g, " ").trim();
      key = (cal && cal.name ? cal.name : e.source || "") + "|" + e.date + "|" + (e.time || "") + "|" + title;
    }
    return (fnv1a32(key, 0x811c9dc5) + fnv1a32(key, 0x050c5d1f)).slice(0, 12);
  }

  /**
   * Which series a card belongs to: its source plus the calendar UID, for the
   * occurrences of a recurring event — an override (a renamed or cancelled
   * date) keeps both, see ics-core. null for a one-off or a UID-less card: a
   * series of one. The lite list shows a series once, /events its later
   * dates as one line.
   */
  function seriesKey(e) {
    return e && e.recurring && e.uid ? (e.source || "") + "|" + e.uid : null;
  }

  /** A card's "YYYY-MM-DD" + "HH:MM" (local wall time, as toCard writes it), `plusDays` later, as epoch ms. */
  function localMs(date, time, plusDays) {
    var d = date.split("-"), t = (time || "00:00").split(":");
    return new Date(+d[0], +d[1] - 1, +d[2] + (plusDays || 0), +t[0], +t[1]).getTime();
  }

  /**
   * When a card stops being current, as epoch ms: the end the source gave.
   * An all-day event runs to the end of its last day (endDate is exclusive,
   * like the ICS DTEND); a timed one without a usable end — none, or none
   * after its start — to the end of its day: an end we don't know is no
   * reason to hide it early.
   */
  function endsAt(card) {
    var dayEnd = localMs(card.date, "", 1);
    if (!card.time) return card.endDate > card.date ? localMs(card.endDate, "") : dayEnd;
    if (card.endTime) {
      var end = localMs(card.endDate || card.date, card.endTime);
      if (end > localMs(card.date, card.time)) return end;
    }
    return dayEnd;
  }

  /**
   * Whether a card is over at `now` (a Date or epoch ms). The one rule for
   * every list — sync, /events, homepage, kiosk, lite: an event shows while
   * it runs, not only until it starts.
   */
  function isOver(card, now) {
    return endsAt(card) <= +now;
  }

  /** "läuft" without a known end: for this long after the start (the kiosk's window). */
  var NO_END_RUNNING_MS = 3 * 3600000;

  /**
   * Whether a timed card runs at `now`: from its start to its end — without
   * an end for NO_END_RUNNING_MS, not to midnight: "läuft" is a claim, the
   * list just keeps showing it (isOver). A cancelled date never runs; an
   * all-day one is "heute" instead (whenWord).
   */
  function isRunning(card, now) {
    if (!card.time || isCancelledTitle(card.title)) return false;
    var start = localMs(card.date, card.time);
    var end = card.endTime ? localMs(card.endDate || card.date, card.endTime) : start;
    if (end <= start) end = start + NO_END_RUNNING_MS;
    return start <= +now && +now < end;
  }

  /** "YYYY-MM-DD" of `now` plus `plusDays`, local. */
  function dayKey(now, plusDays) {
    var d = new Date(+now);
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (plusDays || 0));
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  /**
   * The word a list puts before a card's time: "läuft" while it runs,
   * "heute" / "morgen" by its day (a multi-day all-day event is "heute" on
   * each of its days), else "".
   */
  function whenWord(card, now) {
    if (isRunning(card, now)) return "läuft";
    var today = dayKey(now, 0);
    if (card.date === today || (!card.time && card.date < today && card.endDate > today)) return "heute";
    return card.date === dayKey(now, 1) ? "morgen" : "";
  }

  var WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

  /**
   * A series' rhythm from its dates (YYYY-MM-DD, any order): "jeden Dienstag"
   * when they run a week apart, "jeden 3. Freitag" / "jeden letzten Freitag"
   * when they fall on that weekday of consecutive months. At least three
   * dates — two may be all there is; anything else (a skipped week or month,
   * the 1st, 2nd and 4th Friday) gets "": a rhythm the data does not show is
   * left out rather than guessed.
   */
  function rhythmLabel(dates) {
    var seen = {};
    var ds = (dates || []).filter(function (s) { return !seen[s] && (seen[s] = true); }).sort();
    if (ds.length < 3) return "";
    var parsed = ds.map(function (s) {
      var p = s.split("-");
      return new Date(+p[0], +p[1] - 1, +p[2]);
    });
    var wd = parsed[0].getDay();
    var name = WEEKDAYS[wd];
    var weekly = true, monthly = true, nth = Math.ceil(parsed[0].getDate() / 7), last = true;
    for (var i = 0; i < parsed.length; i++) {
      var d = parsed[i];
      if (d.getDay() !== wd) return "";
      if (i > 0) {
        var prev = parsed[i - 1];
        if (Math.round((localMs(ds[i], "") - localMs(ds[i - 1], "")) / 86400000) !== 7) weekly = false;
        if ((d.getFullYear() * 12 + d.getMonth()) - (prev.getFullYear() * 12 + prev.getMonth()) !== 1) monthly = false;
      }
      if (Math.ceil(d.getDate() / 7) !== nth) nth = 0;
      if (d.getDate() + 7 <= new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()) last = false;
    }
    if (weekly) return "jeden " + name;
    if (!monthly) return "";
    // A 5th weekday is the last one too: "letzten" reads it for every month.
    if (nth && nth < 5) return "jeden " + nth + ". " + name;
    return last ? "jeden letzten " + name : "";
  }

  /**
   * The "→ kalender" target for a card without an event URL. A Nextcloud
   * calendar view (…/apps/calendar/…) opens on the event's day; any other
   * calendar page (bitcircus101.de/calendar/) has no day route and is linked as is.
   */
  function calendarHref(url, date) {
    var base = String(url || "").replace(/\/+$/, "");
    return /\/apps\/calendar\//.test(base + "/") ? base + "/timeGridDay/" + date : url;
  }

  // ── Relation of a source to the space ─────────────────────────────────────
  // One field in calendars/<source>.json says what a calendar is to us:
  //   own    — our calendar (exactly one; check-calendars.mjs gates it)
  //   home   — someone else's calendar whose events take place at bitcircus101
  //   friend — a befriended space elsewhere: opt-in on /termine, never in the
  //            primary feed, the homepage teaser, /status or lite
  // Missing or unknown → friend, so a new source never lands in the default
  // view by accident. The sync copies it onto events-data.json `sources[]`;
  // cards keep only the source NAME, so consumers join through relationMap().
  var RELATIONS = ["own", "home", "friend"];

  function relationOf(cal) {
    var r = cal && cal.relation;
    return r === "own" || r === "home" ? r : "friend";
  }

  /** At bitcircus101: our own calendar and the home sources. */
  function isHome(cal) {
    return relationOf(cal) !== "friend";
  }

  /**
   * Whether a source feeds feed.xml / ical.ics / the events.html JSON-LD: the
   * `rss` override when set, else the home set.
   */
  function inPrimaryFeed(cal) {
    return cal.rss != null ? cal.rss === true : isHome(cal);
  }

  /**
   * Whether a source's events get their own page (/e/<id>/) and the archive:
   * the `pages` flag, else whatever the primary feed carries.
   */
  function hasPages(cal) {
    return (cal.pages != null ? cal.pages : inPrimaryFeed(cal)) === true;
  }

  /**
   * { sourceName: relation } from a list of sources — events-data.json
   * `sources[]` or loadCalendars() output, both carry `name` + `relation`.
   * null when no entry carries `relation` at all: data written before the
   * field existed, where sourceRelation() treats everything as home so a page
   * degrades to the old "show everything" view until the next sync.
   */
  function relationMap(sources) {
    if (!Array.isArray(sources) || !sources.length) return null;
    var map = Object.create(null);
    var any = false;
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      if (!s || typeof s.name !== "string") continue;
      if (s.relation != null) any = true;
      map[s.name] = relationOf(s);
    }
    return any ? map : null;
  }

  /** A card's relation by its source name: no name → own, no map → home, unknown → friend. */
  function sourceRelation(map, name) {
    if (!name) return "own";
    if (!map) return "home";
    return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : "friend";
  }

  /**
   * The card's source line: "" for our own calendar (and for pre-field data,
   * where no line beats a wrong one), "Kalender: X" for a home source,
   * "Externer Kalender: X" for a friend.
   */
  function sourceBadge(map, name) {
    if (!map) return "";
    var rel = sourceRelation(map, name);
    if (rel === "own") return "";
    return (rel === "home" ? "Kalender: " : "Externer Kalender: ") + name;
  }

  /** ONE parsed ICS event → ONE card. Pure — no date filtering, no cap, no sort. */
  function toCard(e, cal) {
    // External calendars (ics-single, ics-filtered) link directly to event/program
    // pages; the other sources link their calendar page (calendarHref), so we keep
    // eventUrl unset.
    var isExternal = cal.type === "ics-filtered" || cal.type === "ics-single";
    // ICS URL > config-level eventUrl > calendar-level url (external only). A URL
    // that only names our own start page says nothing about the event: a partner
    // calendar uses it for "takes place at bitcircus101" — drop it.
    var url = /^https?:\/\/(www\.)?bitcircus101\.de\/?$/i.test(e.url || "") ? "" : e.url;
    var eventLink = url || cal.eventUrl || (isExternal ? cal.url : null);
    // Carry the parsed end through as local date/time strings so the iCal export
    // can emit a real DTEND. Empty when the source gave neither DTEND nor DURATION.
    var end = e.dtend || null;
    var date = e.dtstart.getFullYear() + "-" + pad(e.dtstart.getMonth() + 1) + "-" + pad(e.dtstart.getDate());
    var time = e.allDay ? "" : pad(e.dtstart.getHours()) + ":" + pad(e.dtstart.getMinutes());
    var card = {
      id: eventId({ uid: e.uid, recurring: e.recurring, title: e.summary, date: date, time: time }, cal),
      title: e.summary,
      subtitle: "",
      description: e.description || "",
      location: cleanLocation(e.location),
      date: date,
      time: time,
      endDate: end ? end.getFullYear() + "-" + pad(end.getMonth() + 1) + "-" + pad(end.getDate()) : "",
      endTime: end && !e.allDay ? pad(end.getHours()) + ":" + pad(end.getMinutes()) : "",
      tags: buildTags(e.summary, e.description, e.categories, cal.tags || []),
      type: guessType(e.summary),
      source: cal.name,
      uid: e.uid || "",
      calendarUrl: eventLink || cal.url,
    };
    // Appended after the literal on purpose: all three are optional, and eventUrl must
    // stay the LAST key when present (JSON.stringify order in events-data.json);
    // `id` is the FIRST for the same reason — all pinned by the golden test.
    if (e.recurring) card.recurring = true;
    if (hasPages(cal)) card.page = true;
    if (eventLink) card.eventUrl = eventLink;
    return card;
  }

  /**
   * Full pure pipeline: drop internal events and those that are over, sort by
   * start, apply the per-source cap, map to cards. `now` is injectable for
   * deterministic tests; both existing 2-arg call sites (sync + check-calendars
   * --probe) default to the wall clock.
   */
  function toCards(icsEvents, cal, now) {
    now = now || new Date();
    var cap = typeof cal.cap === "number" && isFinite(cal.cap) ? cal.cap : 30;
    var cards = icsEvents
      .filter(function (e) { return !isInternal(e.summary); })
      .sort(function (a, b) { return a.dtstart - b.dtstart; })
      .map(function (e) { return toCard(e, cal); })
      // isOver, not "starts after now": the hourly sync used to drop a 19:00
      // event at its first run past 19:00, so it left every page while it ran.
      .filter(function (c) { return !isOver(c, now); });
    // The rhythm needs every date to the horizon, not the capped few: the
    // 40-card window held a monthly series twice (October 2026) — too few
    // for rhythmLabel, and the lists see only the window.
    var dates = {};
    cards.forEach(function (c) {
      var key = seriesKey(c);
      if (key) (dates[key] = dates[key] || []).push(c.date);
    });
    return cards.slice(0, cap).map(function (c) {
      var key = seriesKey(c);
      return withRhythm(c, key ? rhythmLabel(dates[key]) : "");
    });
  }

  /** `card` plus `rhythm` when there is one — before eventUrl, which stays the last key. */
  function withRhythm(card, rhythm) {
    if (!rhythm) return card;
    var out = {};
    Object.keys(card).forEach(function (k) { if (k !== "eventUrl") out[k] = card[k]; });
    out.rhythm = rhythm;
    if (card.eventUrl) out.eventUrl = card.eventUrl;
    return out;
  }

  /** Runaway guard for the archive pass — every series runs to the horizon
   *  (ics-core), and 500 catches a broken export. */
  var MAX_ALL_CARDS = 500;

  /**
   * Archive pipeline: every event the export still carries — past and future —
   * minus internal ones, sorted, NO date filter and NO per-source cap. Feeds the
   * event-page archive (sync-events.mjs mergeArchive). Warns and truncates instead
   * of throwing: the sync must never die on data.
   */
  function toAllCards(icsEvents, cal) {
    var all = icsEvents
      .filter(function (e) { return !isInternal(e.summary); })
      .sort(function (a, b) { return a.dtstart - b.dtstart; });
    if (all.length > MAX_ALL_CARDS) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[" + cal.name + "] archive pass: " + all.length + " events, keeping the latest " + MAX_ALL_CARDS);
      }
      all = all.slice(all.length - MAX_ALL_CARDS);
    }
    return all.map(function (e) { return toCard(e, cal); });
  }

  return {
    isInternal: isInternal,
    guessType: guessType,
    isCancelledTitle: isCancelledTitle,
    stripCancelMarker: stripCancelMarker,
    extractHashtags: extractHashtags,
    keywordTags: keywordTags,
    buildTags: buildTags,
    cleanLocation: cleanLocation,
    truncateDesc: truncateDesc,
    stripTagLines: stripTagLines,
    calendarHref: calendarHref,
    fnv1a32: fnv1a32,
    eventId: eventId,
    seriesKey: seriesKey,
    endsAt: endsAt,
    isOver: isOver,
    isRunning: isRunning,
    whenWord: whenWord,
    rhythmLabel: rhythmLabel,
    hasPages: hasPages,
    RELATIONS: RELATIONS,
    relationOf: relationOf,
    isHome: isHome,
    inPrimaryFeed: inPrimaryFeed,
    relationMap: relationMap,
    sourceRelation: sourceRelation,
    sourceBadge: sourceBadge,
    toCard: toCard,
    toCards: toCards,
    toAllCards: toAllCards,
    MAX_ALL_CARDS: MAX_ALL_CARDS,
  };
});
