import { describe, expect, it } from 'vitest';
import {
	formatClock,
	formatInstant,
	formatRemaining,
	instantToLocalFields,
	localToInstant,
	offsetMinutes,
	parseInstant,
	remaining,
} from '../src/time';

function instant(date: string, time: string, tz: string): string {
	const r = localToInstant(date, time, tz);
	if (!r.ok) throw new Error(`${date} ${time} ${tz}: ${r.reason}`);
	return formatInstant(r.ms, r.offset);
}

describe('échéance : heure locale vers instant absolu', () => {
	it('applique l’heure d’hiver ou d’été selon la date choisie (Paris)', () => {
		expect(instant('2026-12-20', '18:00', 'Europe/Paris')).toBe('2026-12-20T18:00:00+01:00');
		expect(instant('2026-07-14', '18:00', 'Europe/Paris')).toBe('2026-07-14T18:00:00+02:00');
	});

	it('gère les fuseaux à demi-heure et négatifs', () => {
		expect(instant('2026-12-20', '18:00', 'Asia/Kolkata')).toBe('2026-12-20T18:00:00+05:30');
		expect(instant('2026-12-20', '18:00', 'America/New_York')).toBe('2026-12-20T18:00:00-05:00');
		expect(instant('2026-12-20', '18:00', 'UTC')).toBe('2026-12-20T18:00:00+00:00');
	});

	it('représente le même instant quel que soit le fuseau qui le lit', () => {
		const paris = parseInstant(instant('2026-12-20', '18:00', 'Europe/Paris'));
		const ny = parseInstant(instant('2026-12-20', '12:00', 'America/New_York'));
		expect(paris).not.toBeNull();
		expect(paris).toBe(ny);
		expect(paris).toBe(Date.UTC(2026, 11, 20, 17, 0));
	});

	it('refuse une heure inexistante (passage à l’heure d’été)', () => {
		expect(localToInstant('2026-03-29', '02:30', 'Europe/Paris')).toEqual({ ok: false, reason: 'nonexistent' });
		expect(localToInstant('2026-03-08', '02:30', 'America/New_York')).toEqual({ ok: false, reason: 'nonexistent' });
		expect(localToInstant('2026-10-04', '02:15', 'Australia/Lord_Howe')).toEqual({ ok: false, reason: 'nonexistent' });
	});

	it('refuse une heure ambiguë (retour à l’heure d’hiver)', () => {
		expect(localToInstant('2026-10-25', '02:30', 'Europe/Paris')).toEqual({ ok: false, reason: 'ambiguous' });
		expect(localToInstant('2026-11-01', '01:30', 'America/New_York')).toEqual({ ok: false, reason: 'ambiguous' });
		expect(localToInstant('2026-04-05', '01:45', 'Australia/Lord_Howe')).toEqual({ ok: false, reason: 'ambiguous' });
	});

	it('accepte les heures juste autour des changements', () => {
		expect(instant('2026-03-29', '01:59', 'Europe/Paris')).toBe('2026-03-29T01:59:00+01:00');
		expect(instant('2026-03-29', '03:00', 'Europe/Paris')).toBe('2026-03-29T03:00:00+02:00');
		expect(instant('2026-10-25', '01:59', 'Europe/Paris')).toBe('2026-10-25T01:59:00+02:00');
		expect(instant('2026-10-25', '03:00', 'Europe/Paris')).toBe('2026-10-25T03:00:00+01:00');
	});

	it('refuse les dates et heures invalides', () => {
		for (const [d, t] of [
			['2026-02-30', '10:00'],
			['2026-13-01', '10:00'],
			['2026-1-01', '10:00'],
			['2026-01-01', '24:00'],
			['2026-01-01', '10:60'],
			['', ''],
		] as const) {
			expect(localToInstant(d, t, 'Europe/Paris')).toEqual({ ok: false, reason: 'invalid' });
		}
		expect(localToInstant('2028-02-29', '10:00', 'UTC').ok).toBe(true);
	});
});

describe('lecture des instants ISO', () => {
	it('lit les décalages et Z', () => {
		expect(parseInstant('2026-12-20T18:00:00+01:00')).toBe(Date.UTC(2026, 11, 20, 17));
		expect(parseInstant('2026-12-20T18:00+01:00')).toBe(Date.UTC(2026, 11, 20, 17));
		expect(parseInstant('2026-12-20T17:00:00Z')).toBe(Date.UTC(2026, 11, 20, 17));
		expect(parseInstant('2026-12-20T18:00:00+05:30')).toBe(Date.UTC(2026, 11, 20, 12, 30));
	});
	it('refuse un instant sans décalage ou mal formé', () => {
		for (const s of ['2026-12-20T18:00:00', '2026-12-20', '2026-02-30T10:00Z', '2026-12-20T18:00:00+15:00', 'demain']) {
			expect(parseInstant(s), s).toBeNull();
		}
	});
	it('fait l’aller-retour écriture-lecture', () => {
		const ms = Date.UTC(2026, 6, 14, 16, 0);
		expect(parseInstant(formatInstant(ms, 120))).toBe(ms);
		expect(parseInstant(formatInstant(ms, -330))).toBe(ms);
	});
	it('pré-remplit le formulaire dans l’heure locale du lecteur', () => {
		const ms = parseInstant('2026-12-20T18:00:00+01:00') ?? NaN;
		expect(instantToLocalFields(ms, 'Europe/Paris')).toEqual({ date: '2026-12-20', time: '18:00' });
		expect(instantToLocalFields(ms, 'America/New_York')).toEqual({ date: '2026-12-20', time: '12:00' });
	});
	it('calcule les décalages', () => {
		expect(offsetMinutes(Date.UTC(2026, 0, 1), 'Europe/Paris')).toBe(60);
		expect(offsetMinutes(Date.UTC(2026, 6, 1), 'Europe/Paris')).toBe(120);
		expect(offsetMinutes(Date.UTC(2026, 0, 1), 'Asia/Kolkata')).toBe(330);
	});
});

describe('temps restant', () => {
	const target = Date.UTC(2026, 11, 20, 17);
	it('décompose le temps restant', () => {
		const r = remaining(target, target - (2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000);
		expect(r).toEqual({ done: false, days: 2, hours: 3, minutes: 4, seconds: 5 });
		expect(formatRemaining(r)).toBe('2 j 03:04:05');
		expect(formatRemaining(remaining(target, target - 65_000))).toBe('00:01:05');
	});
	it('arrondit à la seconde supérieure avant l’échéance', () => {
		expect(remaining(target, target - 500)).toMatchObject({ done: false, seconds: 1 });
	});
	it('reste à zéro à l’échéance et après', () => {
		const zero = { done: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
		expect(remaining(target, target)).toEqual(zero);
		expect(remaining(target, target + 86_400_000)).toEqual(zero);
		expect(formatRemaining(remaining(target, target + 1))).toBe('00:00:00');
	});
});

describe('horloge', () => {
	const ms = Date.UTC(2026, 11, 20, 23, 5, 9); // 00:05:09 le 21 à Paris
	it('format 24 h, avec ou sans secondes', () => {
		expect(formatClock(ms, { hour12: false, seconds: false }, 'Europe/Paris')).toBe('00:05');
		expect(formatClock(ms, { hour12: false, seconds: true }, 'Europe/Paris')).toBe('00:05:09');
	});
	it('format 12 h', () => {
		expect(formatClock(ms, { hour12: true, seconds: false }, 'Europe/Paris')).toBe('12:05 AM');
		expect(formatClock(ms, { hour12: true, seconds: true }, 'UTC')).toBe('11:05:09 PM');
		expect(formatClock(Date.UTC(2026, 0, 1, 12), { hour12: true, seconds: false }, 'UTC')).toBe('12:00 PM');
	});
});
