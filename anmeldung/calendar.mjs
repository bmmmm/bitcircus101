// UTC timestamps preserve the event's instant across calendar time zones.
const utc = (date) => new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const escape = (text) => String(text).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');

function fold(line) {
    const parts = [];
    let part = '';
    let bytes = 0;
    for (const char of line) {
        const size = new TextEncoder().encode(char).length;
        if (bytes + size > 75) {
            parts.push(part);
            part = ' ';
            bytes = 1;
        }
        part += char;
        bytes += size;
    }
    parts.push(part);
    return parts.join('\r\n');
}

export function calendarFile(event, now = new Date()) {
    return [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//bitcircus101//on rails//DE',
        'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
        `UID:${escape(event.id)}@bitcircus101.de`, `DTSTAMP:${utc(now)}`,
        `DTSTART:${utc(event.startsAt)}`, `SUMMARY:${escape(event.title)}`,
        `LOCATION:${escape(event.location)}`,
        `DESCRIPTION:${escape(`Einfahrt um 11 Uhr. ${event.directions}\n${event.bring}\nFragen: ${event.contact}`)}`,
        'END:VEVENT', 'END:VCALENDAR', '',
    ].map(fold).join('\r\n');
}
