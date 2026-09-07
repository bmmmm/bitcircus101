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
   * Tag resolution — 3 sources, in priority:
   *
   * 1. Explicit #hashtags in the event description  (you control these in Nextcloud)
   * 2. ICS CATEGORIES field                         (Nextcloud calendar categories)
   * 3. Keyword auto-detection from title/description (fallback)
   *
   * → Write "#workshop #hardware" anywhere in the Nextcloud event description
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

  /** Truncate description to ~200 chars at word boundary */
  function truncateDesc(s, max) {
    if (max == null) max = 200;
    if (!s || s.length <= max) return s;
    var cut = s.slice(0, max);
    var last = cut.lastIndexOf(" ");
    return (last > 0 ? cut.slice(0, last) : cut) + " …";
  }

  /** ONE parsed ICS event → ONE card. Pure — no date filtering, no cap, no sort. */
  function toCard(e, cal) {
    // External calendars (ics-single, ics-filtered) link directly to event/program
    // pages; built-in Nextcloud sources use the timeGridDay day view, so we keep
    // eventUrl unset.
    var isExternal = cal.type === "ics-filtered" || cal.type === "ics-single";
    // ICS URL > config-level eventUrl > calendar-level url (external only)
    var eventLink = e.url || cal.eventUrl || (isExternal ? cal.url : null);
    // Carry the parsed end through as local date/time strings so the iCal export
    // can emit a real DTEND. Empty when the source gave neither DTEND nor DURATION.
    var end = e.dtend || null;
    var card = {
      title: e.summary,
      subtitle: "",
      description: truncateDesc(e.description),
      location: cleanLocation(e.location),
      date: e.dtstart.getFullYear() + "-" + pad(e.dtstart.getMonth() + 1) + "-" + pad(e.dtstart.getDate()),
      time: e.allDay ? "" : pad(e.dtstart.getHours()) + ":" + pad(e.dtstart.getMinutes()),
      endDate: end ? end.getFullYear() + "-" + pad(end.getMonth() + 1) + "-" + pad(end.getDate()) : "",
      endTime: end && !e.allDay ? pad(end.getHours()) + ":" + pad(end.getMinutes()) : "",
      tags: buildTags(e.summary, e.description, e.categories, cal.tags || []),
      type: guessType(e.summary),
      source: cal.name,
      uid: e.uid || "",
      calendarUrl: eventLink || cal.url,
    };
    // Appended after the literal on purpose: eventUrl is optional and must stay
    // the LAST key when present (JSON.stringify order in events-data.json).
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

  return {
    isInternal: isInternal,
    guessType: guessType,
    extractHashtags: extractHashtags,
    keywordTags: keywordTags,
    buildTags: buildTags,
    cleanLocation: cleanLocation,
    truncateDesc: truncateDesc,
    toCard: toCard,
    toCards: toCards,
  };
});
