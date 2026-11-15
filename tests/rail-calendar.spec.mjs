import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarFile } from '../anmeldung/calendar.mjs';
import { event } from '../anmeldung/event.mjs';

test('rail calendar keeps the correct winter instant, escapes text and folds UTF-8 lines', () => {
    const calendar = calendarFile({ ...event, location: 'Bonn, Gleis; 1\\2\nTreffpunkt', bring: 'Ä'.repeat(90) }, new Date('2026-11-15T10:00:00Z'));
    const unfolded = calendar.replace(/\r\n /g, '');
    assert.match(unfolded, /DTSTART:20270123T100000Z\r\n/);
    assert.match(unfolded, /DTSTAMP:20261115T100000Z\r\n/);
    assert.match(unfolded, /LOCATION:Bonn\\, Gleis\\; 1\\\\2\\nTreffpunkt/);
    assert.ok(!calendar.includes('DTEND'), 'no end time has been confirmed');
    assert.ok(calendar.endsWith('END:VCALENDAR\r\n'));
    for (const line of calendar.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
});
