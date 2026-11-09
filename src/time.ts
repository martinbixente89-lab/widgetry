// Dates et heures : échéance absolue, fuseaux, changements d'heure, formats d'affichage.
// Ce fichier n'importe pas `obsidian` : il est testé directement avec Vitest.
// `timeZone` absent = fuseau de l'ordinateur.

const MINUTE = 60_000;
const DAY = 86_400_000;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string | undefined): Intl.DateTimeFormat {
	const key = timeZone ?? '';
	let fmt = formatters.get(key);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat('en-US', {
			timeZone,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
		});
		formatters.set(key, fmt);
	}
	return fmt;
}

interface WallClock {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

/** Heure affichée par une horloge murale du fuseau, à l'instant `utcMs`. */
export function wallClock(utcMs: number, timeZone?: string): WallClock {
	const parts: Record<string, string> = {};
	for (const p of formatterFor(timeZone).formatToParts(new Date(utcMs))) {
		parts[p.type] = p.value;
	}
	const hour = Number(parts.hour);
	return {
		year: Number(parts.year),
		month: Number(parts.month),
		day: Number(parts.day),
		hour: hour === 24 ? 0 : hour,
		minute: Number(parts.minute),
		second: Number(parts.second),
	};
}

/** Décalage du fuseau par rapport à UTC, en minutes, à l'instant `utcMs`. */
export function offsetMinutes(utcMs: number, timeZone?: string): number {
	const w = wallClock(utcMs, timeZone);
	const wallMs = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
	const flooredUtc = Math.floor(utcMs / 1000) * 1000;
	return Math.round((wallMs - flooredUtc) / MINUTE);
}

function validDate(year: number, month: number, day: number): boolean {
	if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
	const d = new Date(Date.UTC(year, month - 1, day));
	return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export type LocalToInstant =
	| { ok: true; ms: number; offset: number }
	| { ok: false; reason: 'invalid' | 'nonexistent' | 'ambiguous' };

/**
 * Convertit une date (AAAA-MM-JJ) et une heure (HH:MM) locales en instant absolu,
 * selon les règles du fuseau pour cette date précise.
 * Refuse les heures inexistantes (passage à l'heure d'été) et ambiguës (retour à l'heure d'hiver).
 */
export function localToInstant(date: string, time: string, timeZone?: string): LocalToInstant {
	const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	const tm = /^(\d{2}):(\d{2})$/.exec(time);
	if (!dm || !tm) return { ok: false, reason: 'invalid' };
	const [year, month, day] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
	const [hour, minute] = [Number(tm[1]), Number(tm[2])];
	if (!validDate(year, month, day) || hour > 23 || minute > 59) {
		return { ok: false, reason: 'invalid' };
	}
	const wall = Date.UTC(year, month - 1, day, hour, minute);
	const offsets = new Set([
		offsetMinutes(wall - DAY, timeZone),
		offsetMinutes(wall, timeZone),
		offsetMinutes(wall + DAY, timeZone),
	]);
	const found: { ms: number; offset: number }[] = [];
	for (const offset of offsets) {
		const ms = wall - offset * MINUTE;
		if (offsetMinutes(ms, timeZone) === offset && !found.some((f) => f.ms === ms)) {
			found.push({ ms, offset });
		}
	}
	const only = found[0];
	if (found.length === 0 || !only) return { ok: false, reason: 'nonexistent' };
	if (found.length > 1) return { ok: false, reason: 'ambiguous' };
	return { ok: true, ms: only.ms, offset: only.offset };
}

/** Écrit un instant au format ISO 8601 avec le décalage donné (en minutes). */
export function formatInstant(ms: number, offset: number): string {
	const local = new Date(ms + offset * MINUTE);
	const sign = offset < 0 ? '-' : '+';
	const abs = Math.abs(offset);
	return (
		`${pad(local.getUTCFullYear(), 4)}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
		`T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
		`${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
	);
}

/**
 * Lit un instant ISO 8601 strict, avec décalage obligatoire (Z ou ±HH:MM).
 * Renvoie le nombre de millisecondes depuis l'époque Unix, ou null.
 */
export function parseInstant(text: string): number | null {
	const m =
		/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(
			text,
		);
	if (!m) return null;
	const year = Number(m[1]);
	const month = Number(m[2]);
	const day = Number(m[3]);
	const hour = Number(m[4]);
	const minute = Number(m[5]);
	const second = m[6] === undefined ? 0 : Number(m[6]);
	if (!validDate(year, month, day) || hour > 23 || minute > 59 || second > 59) return null;
	let offset = 0;
	if (m[7] !== undefined) {
		const oh = Number(m[8]);
		const om = Number(m[9]);
		if (oh > 14 || om > 59) return null;
		offset = (m[7] === '-' ? -1 : 1) * (oh * 60 + om);
	}
	return Date.UTC(year, month - 1, day, hour, minute, second) - offset * MINUTE;
}

export function isValidInstant(text: string): boolean {
	return parseInstant(text) !== null;
}

/** Date (AAAA-MM-JJ) et heure (HH:MM) locales d'un instant, pour pré-remplir le formulaire. */
export function instantToLocalFields(ms: number, timeZone?: string): { date: string; time: string } {
	const w = wallClock(ms, timeZone);
	return {
		date: `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`,
		time: `${pad(w.hour)}:${pad(w.minute)}`,
	};
}

export interface Remaining {
	done: boolean;
	days: number;
	hours: number;
	minutes: number;
	seconds: number;
}

/** Temps restant jusqu'à `targetMs`. Reste à zéro une fois l'échéance atteinte. */
export function remaining(targetMs: number, nowMs: number): Remaining {
	const diff = targetMs - nowMs;
	if (diff <= 0) return { done: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
	const total = Math.ceil(diff / 1000);
	return {
		done: false,
		days: Math.floor(total / 86400),
		hours: Math.floor((total % 86400) / 3600),
		minutes: Math.floor((total % 3600) / 60),
		seconds: total % 60,
	};
}

export function formatRemaining(r: Remaining): string {
	const hms = `${pad(r.hours)}:${pad(r.minutes)}:${pad(r.seconds)}`;
	return r.days > 0 ? `${r.days} j ${hms}` : hms;
}

/** Heure affichée par l'horloge, au format 24 h ou 12 h, avec ou sans secondes. */
export function formatClock(
	ms: number,
	options: { hour12: boolean; seconds: boolean },
	timeZone?: string,
): string {
	const w = wallClock(ms, timeZone);
	const sec = options.seconds ? `:${pad(w.second)}` : '';
	if (options.hour12) {
		const h = w.hour % 12 === 0 ? 12 : w.hour % 12;
		return `${h}:${pad(w.minute)}${sec} ${w.hour < 12 ? 'AM' : 'PM'}`;
	}
	return `${pad(w.hour)}:${pad(w.minute)}${sec}`;
}
