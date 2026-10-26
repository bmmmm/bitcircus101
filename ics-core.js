/**
 * ics-core.js — shared ICS parser used by BOTH the Node sync script
 * (scripts/sync-events.mjs) and the browser (events.js: eventAnchor).
 *
 * Single source of truth: edit the parser here and both consumers update. UMD
 * wrapper exposes `module.exports` under Node (imported by the .mjs sync script)
 * and a global `ICSCore` in the browser (loaded via <script> before events.js).
 *
 * Written in ES5 so the browser build needs no transpilation.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ICSCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var HORIZON_DAYS = 120;
  var WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

  function parseDate(v) {
    if (!v) return null;
    var y = +v.slice(0, 4), m = +v.slice(4, 6) - 1, d = +v.slice(6, 8);
    if (v.length === 8) return new Date(y, m, d);
    var h = +v.slice(9, 11), mi = +v.slice(11, 13);
    return v.charAt(v.length - 1) === "Z"
      ? new Date(Date.UTC(y, m, d, h, mi))
      : new Date(y, m, d, h, mi);
  }

  function nthWeekday(year, month, wd, nth) {
    var d;
    if (nth < 0) {
      // Negative ordinals count back from the end of the month: -1 is the last
      // matching weekday, -2 the one before it (RFC5545 §3.3.10 BYDAY).
      d = new Date(year, month + 1, 0); // day 0 of next month = last day of this one
      while (d.getDay() !== wd) d.setDate(d.getDate() - 1);
      d.setDate(d.getDate() + (nth + 1) * 7);
    } else {
      d = new Date(year, month, 1);
      while (d.getDay() !== wd) d.setDate(d.getDate() + 1);
      d.setDate(d.getDate() + (nth - 1) * 7);
    }
    return d.getMonth() === month ? d : null;
  }

  function expandRRule(dtstart, rule, exdates) {
    var horizon = new Date();
    horizon.setDate(horizon.getDate() + HORIZON_DAYS);
    var p = {};
    rule.split(";").forEach(function (s) {
      var i = s.indexOf("=");
      if (i > -1) p[s.slice(0, i)] = s.slice(i + 1);
    });
    var end = p.UNTIL ? parseDate(p.UNTIL) : null;
    // A date-only UNTIL (no "T") bounds the whole day per RFC5545; without pushing
    // it to end-of-day a timed occurrence on the UNTIL date (19:00 > 00:00) is lost.
    if (end && p.UNTIL.indexOf("T") === -1) end.setHours(23, 59, 59, 999);
    var limit = end && end < horizon ? end : horizon;
    // Without COUNT only `limit` bounds the walk. A fixed cap counted from DTSTART
    // starved every long-running series of its upcoming dates.
    var max = p.COUNT ? +p.COUNT : Infinity;
    var exSet = {};
    exdates.forEach(function (d) { exSet[d.toDateString()] = true; });
    var out = [];
    // Shared by the WEEKLY, MONTHLY-by-monthday + DAILY branches. Clamped to a
    // positive integer: with no COUNT cap, DAILY;INTERVAL=0 would never advance.
    var interval = Math.max(1, Math.floor(+p.INTERVAL) || 1);

    if (p.FREQ === "WEEKLY") {
      // BYDAY may list several weekdays ("MO,WE,FR") — expand every one, not just
      // the last. Each token may carry an ordinal (ignored for WEEKLY): "2MO" -> MO.
      var wdays = {};
      if (p.BYDAY) {
        p.BYDAY.split(",").forEach(function (tok) {
          var code = tok.replace(/[^A-Za-z]/g, "").slice(-2).toUpperCase();
          if (WD[code] != null) wdays[WD[code]] = true;
        });
      }
      if (!Object.keys(wdays).length) wdays[dtstart.getDay()] = true;
      // Walk day by day (cheap over the 120-day horizon), emitting each matching
      // weekday. INTERVAL keeps every Nth week, counted from dtstart's week.
      var weekRef = new Date(dtstart);
      weekRef.setHours(0, 0, 0, 0);
      weekRef.setDate(weekRef.getDate() - weekRef.getDay()); // Sunday of start week
      var cur = new Date(dtstart);
      var genW = 0;
      while (cur <= limit && genW < max) {
        if (cur >= dtstart && wdays[cur.getDay()]) {
          var wkStart = new Date(cur);
          wkStart.setHours(0, 0, 0, 0);
          wkStart.setDate(wkStart.getDate() - wkStart.getDay());
          var weeksApart = Math.round((wkStart - weekRef) / 604800000);
          if (weeksApart % interval === 0) {
            // A matching slot counts toward COUNT even when EXDATE-excluded (RFC5545).
            genW++;
            if (!exSet[cur.toDateString()]) out.push(new Date(cur));
          }
        }
        cur.setDate(cur.getDate() + 1);
      }
    } else if (p.FREQ === "MONTHLY" && p.BYDAY) {
      // BYDAY is a list of weekdays, each with an optional ordinal: "3TH" (3rd
      // Thursday), "-1WE" (last Wednesday), "FR" (every Friday of the month),
      // "1FR,2FR,4FR,5FR" (every Friday but the 3rd). BYSETPOS then picks
      // positions out of the month's sorted set ("FR;BYSETPOS=1,2,4,5" is that
      // same rule; "MO,TU,WE,TH,FR;BYSETPOS=-1" the last workday).
      var toks = [];
      var bad = false;
      p.BYDAY.split(",").forEach(function (tok) {
        var tm = tok.match(/^([+-]?\d+)?([A-Z]{2})$/);
        if (!tm || WD[tm[2]] == null || tm[1] === "0") { bad = true; return; }
        toks.push({ nth: tm[1] ? +tm[1] : null, wd: WD[tm[2]] });
      });
      var setpos = p.BYSETPOS
        ? p.BYSETPOS.split(",").map(Number).filter(function (n) { return n && isFinite(n); })
        : [];
      if (bad || !toks.length) {
        // Unknown day codes: warn rather than drop the series without a trace.
        console.warn(
          "[rrule] unsupported MONTHLY BYDAY=" + p.BYDAY +
          (p.BYSETPOS ? ";BYSETPOS=" + p.BYSETPOS : "") + " — event not expanded"
        );
      } else {
        var mo = new Date(dtstart.getFullYear(), dtstart.getMonth(), 1);
        var genM = 0;
        while (mo <= limit && genM < max) {
          var y = mo.getFullYear(), mon = mo.getMonth();
          var days = {};
          toks.forEach(function (t) {
            if (t.nth) {
              var nd = nthWeekday(y, mon, t.wd, t.nth);
              if (nd) days[nd.getDate()] = true;
              return;
            }
            for (var k = 1; k <= 5; k++) {
              var kd = nthWeekday(y, mon, t.wd, k);
              if (kd) days[kd.getDate()] = true;
            }
          });
          var set = Object.keys(days).map(Number).sort(function (a, b) { return a - b; });
          if (setpos.length) {
            set = setpos
              .map(function (pos) { return set[pos > 0 ? pos - 1 : set.length + pos]; })
              .filter(function (x) { return x != null; })
              .sort(function (a, b) { return a - b; })
              .filter(function (x, i, arr) { return i === 0 || arr[i - 1] !== x; });
          }
          for (var si = 0; si < set.length && genM < max; si++) {
            var d = new Date(y, mon, set[si], dtstart.getHours(), dtstart.getMinutes());
            if (d >= dtstart && d <= limit) {
              genM++; // counts toward COUNT regardless of EXDATE (RFC5545)
              if (!exSet[d.toDateString()]) out.push(d);
            }
          }
          mo.setMonth(mo.getMonth() + 1);
        }
      }
    } else if (p.FREQ === "MONTHLY") {
      // MONTHLY without BYDAY recurs by day-of-month: the BYMONTHDAY list when
      // given (negative values count from the month's end per RFC5545 §3.3.10 —
      // -1 is the last day), else DTSTART's day. A month lacking the day
      // (BYMONTHDAY=31 in February) is skipped, not clamped, and the skipped
      // slot does not count toward COUNT — RFC5545 ignores invalid dates.
      // Before this branch existed such series fell through to the warn below
      // and silently vanished from the site ("jeden 15." never rendered).
      var mdays = [];
      if (p.BYMONTHDAY) {
        p.BYMONTHDAY.split(",").forEach(function (tok) {
          var v = parseInt(tok, 10);
          if (v >= -31 && v <= 31 && v !== 0 && mdays.indexOf(v) === -1) mdays.push(v);
        });
      }
      if (!mdays.length) mdays.push(dtstart.getDate());
      var moM = new Date(dtstart.getFullYear(), dtstart.getMonth(), 1);
      var monthsFrom = 0; // INTERVAL counts months from dtstart's month
      var genMd = 0;
      while (moM <= limit && genMd < max) {
        if (monthsFrom % interval === 0) {
          var dim = new Date(moM.getFullYear(), moM.getMonth() + 1, 0).getDate();
          // Resolve the monthdays for THIS month (negatives depend on its
          // length), dedupe (-1 and 31 collide in a 31-day month), keep
          // chronological order within the month.
          var resolved = [];
          for (var mi = 0; mi < mdays.length; mi++) {
            var day = mdays[mi] > 0 ? mdays[mi] : dim + mdays[mi] + 1;
            if (day >= 1 && day <= dim && resolved.indexOf(day) === -1) resolved.push(day);
          }
          resolved.sort(function (a, b) { return a - b; });
          // BYSETPOS picks one instance out of the month's set (RFC5545): the
          // real calendar carries "BYSETPOS=-1;BYMONTHDAY=28,29,30" = the last
          // existing of those days — month-end via Apple-style rules.
          if (p.BYSETPOS) {
            var pos = +p.BYSETPOS;
            var pick = pos > 0 ? resolved[pos - 1] : resolved[resolved.length + pos];
            resolved = pick != null ? [pick] : [];
          }
          for (var ri = 0; ri < resolved.length && genMd < max; ri++) {
            var dmd = new Date(
              moM.getFullYear(), moM.getMonth(), resolved[ri],
              dtstart.getHours(), dtstart.getMinutes(), 0, 0
            );
            if (dmd >= dtstart && dmd <= limit) {
              genMd++; // counts toward COUNT regardless of EXDATE (RFC5545)
              if (!exSet[dmd.toDateString()]) out.push(new Date(dmd));
            }
          }
        }
        moM.setMonth(moM.getMonth() + 1);
        monthsFrom++;
      }
    } else if (p.FREQ === "DAILY") {
      var cd = new Date(dtstart);
      var genD = 0;
      while (cd <= limit && genD < max) {
        genD++; // counts toward COUNT regardless of EXDATE (RFC5545)
        if (!exSet[cd.toDateString()]) out.push(new Date(cd));
        cd.setDate(cd.getDate() + interval);
      }
    } else if (p.FREQ === "YEARLY") {
      var cy = new Date(dtstart);
      var genY = 0;
      while (cy <= limit && genY < max) {
        genY++; // counts toward COUNT regardless of EXDATE (RFC5545)
        if (!exSet[cy.toDateString()]) out.push(new Date(cy));
        cy.setFullYear(cy.getFullYear() + 1);
      }
    } else {
      // Hourly, minutely, etc. are not expanded — surface it instead of silently
      // dropping the event so a missing series is debuggable from CI logs.
      console.warn("[rrule] unsupported FREQ=" + (p.FREQ || "?") + " — event not expanded");
    }
    return out;
  }

  /**
   * Parse an RFC5545 DURATION ("PT2H", "P1DT1H30M", "P1W") into milliseconds.
   * Returns null for an unparseable value. Weeks and days are counted as fixed
   * 7-day / 24-hour spans (good enough for the short-lived events this site lists;
   * no DST-aware day arithmetic).
   */
  function parseDuration(v) {
    if (!v) return null;
    var m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
    // Reject a value with no time components at all (bare "P"/"PT") — those carry no duration.
    if (!m || !m.slice(2).some(function (g) { return g != null; })) return null;
    var sign = m[1] === "-" ? -1 : 1;
    var secs = +(m[2] || 0) * 604800 + +(m[3] || 0) * 86400 +
               +(m[4] || 0) * 3600 + +(m[5] || 0) * 60 + +(m[6] || 0);
    return sign * secs * 1000;
  }

  function clean(s, keepNewlines) {
    // Unescape RFC5545 text escapes in a single pass. Crucially "\\" is consumed
    // atomically with its escaped char, so a literal backslash is never mistaken
    // for a "\n" newline marker (e.g. "C:\\nope" -> "C:\nope", not "C:\ ope").
    // Single-line fields (SUMMARY, LOCATION) flatten "\n" to a space; DESCRIPTION
    // passes keepNewlines so paragraphs survive into the cards, feeds and pages.
    var out = s.replace(/\\([\\;,nN])/g, function (_, c) {
      return c === "n" || c === "N" ? (keepNewlines ? "\n" : " ") : c;
    });
    if (keepNewlines) out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    return out.trim();
  }

  /** Pull TZID parameter out of a property like "DTSTART;TZID=Europe/Berlin" */
  function parseTzid(rawKey) {
    var m = rawKey.match(/TZID=([^;:]+)/i);
    // A parameter value may be quoted (TZID="Europe/Berlin", RFC5545 §3.2).
    return m ? m[1].replace(/^"|"$/g, "") : null;
  }

  /**
   * Index of the colon that ends the property name + parameters. A quoted
   * parameter value may itself contain colons (ALTREP="https://…"), so the first
   * colon outside double quotes is the separator, not simply the first colon.
   */
  function valueColon(line) {
    var quoted = false;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === '"') quoted = !quoted;
      else if (c === ":" && !quoted) return i;
    }
    return -1;
  }

  var tzidWarned = {};
  var zoneFormats = {};

  /** Offset of `tz` from UTC at instant `ms`, in ms; throws for an unknown zone. */
  function zoneOffset(ms, tz) {
    var fmt = zoneFormats[tz] || (zoneFormats[tz] = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }));
    var p = {};
    fmt.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = +x.value; });
    var wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return wall - Math.floor(ms / 1000) * 1000;
  }

  /**
   * Read a timed local value ("20260915T100000") as wall time in a foreign zone
   * and return the real instant. Europe/Berlin, UTC ("Z") and date-only values
   * keep parseDate's floating reading (the sync runs pinned to Berlin). Returns
   * false for a zone Intl does not know, so the caller can fall back and warn.
   *
   * Only the instant is converted: RRULE expansion still steps in Berlin local
   * time, so a series in a foreign zone can drift by an hour across a DST edge
   * that the two zones do not share. Deliberately left unsolved.
   */
  function parseZoned(v, tz) {
    if (!tz || tz === "Europe/Berlin" || v.indexOf("T") === -1 ||
        v.charAt(v.length - 1) === "Z") return parseDate(v);
    var guess = Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8),
      +v.slice(9, 11), +v.slice(11, 13));
    try {
      var off = zoneOffset(guess, tz);
      var t = guess - off;
      // Second pass: the offset at the guess can differ from the one at the result
      // when a DST switch lies between them.
      var off2 = zoneOffset(t, tz);
      return new Date(off2 === off ? t : guess - off2);
    } catch (e) {
      return false;
    }
  }

  /**
   * Parse VEVENTs into a flat list. Extracts the full field superset
   * (uid/url/categories/tzid); consumers ignore what they don't need.
   * Recurring events are expanded into one entry per occurrence.
   *
   * A VEVENT with RECURRENCE-ID is an override of ONE occurrence of the series
   * that shares its UID (RFC5545 §3.8.4.4): editing a single instance in
   * Nextcloud/Apple Calendar — a rename, a moved time — writes one of these next
   * to the master. It replaces that occurrence: the override is emitted as a
   * recurring instance (so its card id is uid|date, the same id the plain
   * occurrence had when it keeps its day), and the master's occurrence on the
   * RECURRENCE-ID day is dropped. Ignoring RECURRENCE-ID left both — a phantom
   * duplicate — and made a renamed occurrence a separate one-off.
   */
  function parseICS(text, sourceId) {
    sourceId = sourceId || "?";
    var lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
    var events = [];
    var ev = null;
    // uid + "|" + day of every override seen, to drop the master occurrences they
    // replace once the whole file is read (an override may precede its master).
    var overridden = {};
    // Depth of components nested inside the current VEVENT (VALARM, ...). Their
    // properties are not the event's: an Apple VALARM carries its own UID and a
    // DESCRIPTION such as "Reminder", which would overwrite the event's own.
    var nested = 0;

    // A value in a zone Intl does not know keeps the floating local reading;
    // warn once per source/zone so it is debuggable from the CI logs.
    function readTime(v, tz) {
      var d = parseZoned(v, tz);
      if (d !== false) return d;
      var wkey = sourceId + "|" + tz;
      if (!tzidWarned[wkey]) {
        tzidWarned[wkey] = true;
        console.warn("[" + sourceId + "] unknown TZID (" + tz + "); times treated as local");
      }
      return parseDate(v);
    }

    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (line === "BEGIN:VEVENT") { ev = { exdates: [] }; nested = 0; continue; }
      if (line === "END:VEVENT") {
        if (!ev || !ev.dtstart) { ev = null; continue; }
        var dtstart = readTime(ev.dtstart, ev.tzid);
        if (!dtstart) { ev = null; continue; }
        var allDay = ev.dtstart.indexOf("T") === -1;
        // Duration between start and end, reused for every RRULE instance. Prefer an
        // explicit DTEND; fall back to DURATION; leave null when the source gives neither
        // (consumers then apply their own default). All-day DTEND is the exclusive next
        // day per RFC5545, so its span is a whole number of days.
        var durationMs = null;
        var dtend = ev.dtend ? readTime(ev.dtend, ev.dtendTzid) : null;
        if (dtend) durationMs = dtend - dtstart;
        else if (ev.duration) durationMs = parseDuration(ev.duration);
        var base = {
          uid: ev.uid || "",
          url: ev.url || "",
          summary: clean(ev.summary || "(kein Titel)"),
          description: clean(ev.description || "", true),
          location: clean(ev.location || ""),
          categories: ev.categories || "",
          allDay: allDay,
        };
        if (ev.rrule) {
          expandRRule(dtstart, ev.rrule, ev.exdates).forEach(function (d) {
            var inst = {};
            for (var k in base) inst[k] = base[k];
            // Every occurrence shares the series UID, so the card id has to add the
            // date for these — a one-off keeps a date-free id and survives a move.
            inst.recurring = true;
            inst.fromRRule = true;
            inst.dtstart = d;
            inst.dtend = durationMs != null ? new Date(d.getTime() + durationMs) : null;
            events.push(inst);
          });
        } else {
          base.dtstart = dtstart;
          base.dtend = durationMs != null ? new Date(dtstart.getTime() + durationMs) : null;
          // Read through the same clock as DTSTART, so the day matches the
          // instance's day for a foreign TZID too.
          var rid = ev.recurrenceId ? readTime(ev.recurrenceId, ev.recurrenceTzid) : null;
          if (rid && base.uid) {
            base.recurring = true;
            overridden[base.uid + "|" + rid.toDateString()] = true;
          }
          events.push(base);
        }
        ev = null; continue;
      }
      if (!ev) continue;
      if (line.indexOf("BEGIN:") === 0) { nested++; continue; }
      if (line.indexOf("END:") === 0) { if (nested > 0) nested--; continue; }
      if (nested > 0) continue;
      var ci = valueColon(line);
      if (ci === -1) continue;
      var rawKey = line.slice(0, ci);
      var key = rawKey.split(";")[0].toUpperCase();
      var val = line.slice(ci + 1);
      if (key === "DTSTART") { ev.dtstart = val; ev.tzid = parseTzid(rawKey); }
      else if (key === "DTEND") { ev.dtend = val; ev.dtendTzid = parseTzid(rawKey); }
      else if (key === "DURATION") ev.duration = val;
      else if (key === "SUMMARY") ev.summary = val;
      else if (key === "DESCRIPTION") ev.description = val;
      else if (key === "LOCATION") ev.location = val;
      else if (key === "CATEGORIES") ev.categories = val;
      else if (key === "UID") ev.uid = val.trim();
      else if (key === "URL") {
        var u = val.trim();
        // Leave a root- or protocol-relative path ("/x", "//x") alone; only prefix a
        // bare host, so the result never becomes "https:///x". Matches httpUrl() in
        // events.js.
        ev.url = u && u.charAt(0) !== "/" && !/^https?:\/\//i.test(u) ? "https://" + u : u;
      }
      else if (key === "RRULE") ev.rrule = val;
      else if (key === "RECURRENCE-ID") { ev.recurrenceId = val.trim(); ev.recurrenceTzid = parseTzid(rawKey); }
      else if (key === "EXDATE") {
        var exTzid = parseTzid(rawKey);
        val.split(",").forEach(function (v) {
          var d = readTime(v.trim(), exTzid);
          if (d) ev.exdates.push(d);
        });
      }
    }
    // Drop the master occurrences that an override replaced. Matched by day, like
    // EXDATE above: RECURRENCE-ID names the occurrence's original DTSTART.
    var out = [];
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var replaced = e.fromRRule && overridden[e.uid + "|" + e.dtstart.toDateString()];
      delete e.fromRRule;
      if (!replaced) out.push(e);
    }
    return out;
  }

  /**
   * Stable DOM-anchor / RSS-permalink id for an event card. Shared so the feed's
   * <link> deep-links to exactly the anchor events.js renders (no slug drift).
   */
  function eventAnchor(card) {
    var slug = card.date + "-" + (card.title || "").toLowerCase()
      .replace(/[^a-z0-9äöü]+/g, "-")
      .replace(/^-|-$/g, "").slice(0, 40);
    return "ev-" + slug;
  }

  return {
    parseDate: parseDate,
    parseDuration: parseDuration,
    nthWeekday: nthWeekday,
    expandRRule: expandRRule,
    clean: clean,
    parseICS: parseICS,
    eventAnchor: eventAnchor,
  };
});
