/**
 * events-core.js — shared card-shaping logic used by BOTH the Node sync script
 * (scripts/sync-events.mjs) and the browser fallback (events.js).
 *
 * Single source of truth for tags, event type and the card object itself: edit
 * here and both consumers update — the live-ICS fallback renders the same cards
 * as the generated events-data.json. Parsing stays in ics-core.js; this module
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
   * Full pure pipeline: drop past + internal events, sort by start, apply the
   * per-source cap, map to cards. `now` is injectable for deterministic tests;
   * both existing 2-arg call sites (sync + check-calendars --probe) default to
   * the wall clock.
   */
  function toCards(icsEvents, cal, now) {
    now = now || new Date();
    var startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var cap = typeof cal.cap === "number" && isFinite(cal.cap) ? cal.cap : 30;
    return icsEvents
      // All-day events carry no time (midnight). Comparing them against `now` would
      // drop an all-day event happening *today* at any moment past 00:00, so gate them
      // on the start of today instead; timed events keep the strict "future" check.
      .filter(function (e) {
        return (e.allDay ? e.dtstart >= startOfToday : e.dtstart > now) && !isInternal(e.summary);
      })
      .sort(function (a, b) { return a.dtstart - b.dtstart; })
      .slice(0, cap)
      .map(function (e) { return toCard(e, cal); });
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
