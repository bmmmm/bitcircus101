import { event } from './event.mjs';
import { calendarFile } from './calendar.mjs';

const receiptKey = `bc.ticket.${event.id}`;
const preview = event.registrationMode !== 'live';
const themeButton = document.querySelector('.rail-theme');

function syncThemeButton() {
    const light = document.documentElement.dataset.theme === 'light';
    themeButton?.setAttribute('aria-pressed', String(light));
    themeButton?.setAttribute('aria-label', light ? 'Dunkles Design umschalten' : 'Helles Design umschalten');
}
syncThemeButton();
themeButton?.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('bc.theme', theme); } catch { /* Theme still works without storage. */ }
    syncThemeButton();
});

// Defaults to the parked train: JS or CSS failure never hides the illustration.
const train = document.querySelector('.rail-train');
if (train && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    train.classList.add('is-arriving');
    const scene = document.querySelector('.rail-scene');
    scene.classList.add('is-braking');
    const settle = () => {
        train.classList.remove('is-arriving');
        scene.classList.remove('is-braking');
    };
    train.addEventListener('animationend', (e) => { if (e.target === train) settle(); }, { once: true });
    train.addEventListener('animationcancel', settle, { once: true });
    // Fallback also releases will-change if motion preference changes mid-arrival.
    setTimeout(settle, 3600);
}

const form = document.querySelector('#rail-form');
if (form) {
    const button = document.querySelector('#rail-submit');
    const status = document.querySelector('#rail-form-status');
    const startedAt = document.querySelector('#startedAt');
    const fields = ['vorname', 'nachname', 'email'];
    const idleLabel = 'Fahrschein lösen';
    button.querySelector('span').textContent = idleLabel;
    button.disabled = false;
    startedAt.value = String(Date.now());
    document.querySelector('#rail-preview-note').hidden = !preview;

    function showStatus(message) {
        status.textContent = message;
        status.hidden = false;
        status.focus();
    }
    function fieldError(name, message = '') {
        if (!fields.includes(name)) return;
        const input = document.getElementById(name);
        const error = document.getElementById(`${name}-error`);
        input.setAttribute('aria-invalid', String(Boolean(message)));
        error.textContent = message;
        error.hidden = !message;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (button.disabled) return;
        status.hidden = true;
        const data = Object.fromEntries(new FormData(form));
        const errors = {};
        for (const name of fields) {
            data[name] = data[name].trim();
            fieldError(name);
        }
        if (!data.vorname) errors.vorname = 'Bitte gib deinen Vornamen ein.';
        if (!data.nachname) errors.nachname = 'Bitte gib deinen Nachnamen ein.';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || !form.elements.email.validity.valid) errors.email = 'Bitte gib eine gültige E-Mail-Adresse ein.';
        for (const [name, message] of Object.entries(errors)) fieldError(name, message);
        if (Object.keys(errors).length) {
            document.getElementById(Object.keys(errors)[0]).focus();
            return;
        }
        if (data.botcheck) { showStatus('Bitte lade die Seite neu und versuche es erneut.'); return; }
        button.disabled = true;
        button.querySelector('span').textContent = preview ? 'Fahrschein wird erstellt …' : 'Anmeldung wird gesendet …';
        try {
            // The same minimum dwell time applies in preview and live mode.
            await new Promise((resolve) => setTimeout(resolve, Math.max(200, 3050 - (Date.now() - Number(data.startedAt)))));
            if (!preview) {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 15000);
                let response;
                let result;
                try {
                    response = await fetch('/api/anmelden', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...data, eventId: event.id, startedAt: Number(data.startedAt) }),
                        signal: controller.signal,
                    });
                    result = await response.json();
                } finally { clearTimeout(timer); }
                if (!response.ok || result.ok !== true) {
                    if (result.errors) {
                        for (const [name, message] of Object.entries(result.errors)) fieldError(name, message);
                        const first = fields.find((name) => result.errors[name]);
                        if (first) { document.getElementById(first).focus(); return; }
                        if (result.errors.startedAt) startedAt.value = String(Date.now());
                    }
                    showStatus(result.error || result.errors?.startedAt || 'Die Anmeldung hat nicht geklappt. Bitte versuche es erneut.');
                    return;
                }
            }
            // Only a short-lived first name and receipt state pass to the ticket.
            // Email and surname never enter URLs or browser storage.
            try { sessionStorage.setItem(receiptKey, JSON.stringify({ firstName: data.vorname, preview, createdAt: Date.now() })); } catch { /* A generic ticket works without storage. */ }
            window.location.assign('danke.html');
        } catch {
            showStatus('Die Anmeldung ist gerade nicht erreichbar. Bitte prüfe deine Verbindung und versuche es erneut. Bei Fragen: info@bitcircus101.de');
        } finally {
            button.disabled = false;
            button.querySelector('span').textContent = idleLabel;
        }
    });
    // A browser back navigation must not leave the submit button disabled.
    window.addEventListener('pageshow', () => { button.disabled = false; button.querySelector('span').textContent = idleLabel; });
}

const welcome = document.querySelector('#rail-welcome');
if (welcome) {
    let receipt;
    try {
        receipt = JSON.parse(sessionStorage.getItem(receiptKey));
        sessionStorage.removeItem(receiptKey);
    } catch { /* Direct visits and storage restrictions show generic event info. */ }
    if (receipt && (Date.now() - receipt.createdAt < 5 * 60 * 1000) && receipt.createdAt <= Date.now()) {
        const firstName = typeof receipt.firstName === 'string' ? receipt.firstName.slice(0, 80) : '';
        welcome.textContent = firstName ? `Willkommen an Bord, ${firstName}.` : 'Willkommen an Bord.';
        const isPreview = receipt.preview !== false;
        document.querySelector('#rail-confirmation-intro').textContent = isPreview ? 'So sieht dein Fahrschein aus. Der nächste Halt: 23. Januar 2027.' : 'Du bist dabei. Dein Fahrschein für den 23. Januar 2027.';
        document.querySelector('#rail-ticket-preview').hidden = !isPreview;
        document.querySelector('#rail-confirmation-mail').hidden = isPreview;
        document.querySelector('#rail-ticket-state').textContent = isPreview ? 'VORSCHAU' : 'ANGEMELDET';
    } else if (preview) {
        document.querySelector('#rail-ticket-preview').hidden = false;
        document.querySelector('#rail-ticket-state').textContent = 'VORSCHAU';
    }
    document.querySelector('[data-event-location]').textContent = event.location;
    document.querySelector('[data-event-directions]').textContent = event.directions;
    document.querySelector('[data-event-bring]').textContent = event.bring;
    const calendarButton = document.querySelector('#rail-calendar');
    calendarButton.disabled = false;
    calendarButton.addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob([calendarFile(event)], { type: 'text/calendar;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'bitcircus101-on-rails.ics';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    window.addEventListener('pageshow', (e) => {
        if (e.persisted) {
            welcome.textContent = 'Dein nächster Halt.';
            document.querySelector('#rail-confirmation-intro').textContent = 'Hier findest du alle bisher bekannten Infos zum Event. Diese Seite allein bestätigt keine Anmeldung.';
            document.querySelector('#rail-ticket-state').textContent = preview ? 'VORSCHAU' : 'EVENT-INFO';
            document.querySelector('#rail-confirmation-mail').hidden = true;
        }
    });
}
