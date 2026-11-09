// Configuration des widgets : lecture, validation et écriture du JSON des blocs.
// Ce fichier n'importe pas `obsidian` : il est testé directement avec Vitest.

export const LANG = 'widgetry';

export type WidgetType = 'clock' | 'countdown' | 'quote';
export type Size = 'small' | 'medium' | 'large';
export type Align = 'left' | 'center' | 'right';
export type QuoteMode = 'fixed' | 'rotate';

export const WIDGET_TYPES: readonly WidgetType[] = ['clock', 'countdown', 'quote'];
export const SIZES: readonly Size[] = ['small', 'medium', 'large'];
export const ALIGNS: readonly Align[] = ['left', 'center', 'right'];
export const QUOTE_MODES: readonly QuoteMode[] = ['fixed', 'rotate'];

export const MIN_INTERVAL = 5;
export const MAX_INTERVAL = 86400;
export const DEFAULT_INTERVAL = 30;

interface BaseConfig {
	size: Size;
	align: Align;
}

export interface ClockConfig extends BaseConfig {
	type: 'clock';
	hour12: boolean;
	seconds: boolean;
}

export interface CountdownConfig extends BaseConfig {
	type: 'countdown';
	title: string;
	/** Instant ISO 8601 avec décalage, par exemple 2026-12-20T18:00:00+01:00. */
	target: string;
}

export interface QuoteConfig extends BaseConfig {
	type: 'quote';
	mode: QuoteMode;
	interval: number;
	quotes: string[];
}

export type WidgetConfig = ClockConfig | CountdownConfig | QuoteConfig;

export type JsonObject = Record<string, unknown>;

export function defaultConfig(type: WidgetType): WidgetConfig {
	const base: BaseConfig = { size: 'medium', align: 'center' };
	switch (type) {
		case 'clock':
			return { type, hour12: false, seconds: false, ...base };
		case 'countdown':
			return { type, title: '', target: '', ...base };
		case 'quote':
			return {
				type,
				mode: 'fixed',
				interval: DEFAULT_INTERVAL,
				quotes: [''],
				...base,
			};
	}
}

/** Champs connus d'un widget, dans l'ordre d'écriture. */
export function knownFields(config: WidgetConfig): JsonObject {
	switch (config.type) {
		case 'clock':
			return {
				type: config.type,
				hour12: config.hour12,
				seconds: config.seconds,
				size: config.size,
				align: config.align,
			};
		case 'countdown':
			return {
				type: config.type,
				title: config.title,
				target: config.target,
				size: config.size,
				align: config.align,
			};
		case 'quote':
			return {
				type: config.type,
				mode: config.mode,
				interval: config.interval,
				quotes: [...config.quotes],
				size: config.size,
				align: config.align,
			};
	}
}

export type ReadResult =
	| {
			ok: true;
			data: JsonObject;
			config: WidgetConfig;
			/** Raison pour laquelle le formulaire ne peut pas réécrire ce bloc sans perte, sinon null. */
			editBlocker: string | null;
	  }
	| { ok: false; error: string };

/**
 * Lit le contenu d'un bloc `widgetry`.
 * Refuse (ok: false) un contenu illisible ou ambigu. Signale dans `editBlocker`
 * les données lisibles mais qu'une réécriture ne pourrait pas conserver.
 */
export function readBlock(source: string): ReadResult {
	const numberIssues: string[] = [];
	let numbers = 0;
	let numbersWithSource = 0;

	const reviver = function (
		_key: string,
		value: unknown,
		context?: { source?: unknown },
	): unknown {
		if (typeof value === 'number') {
			numbers++;
			const src = context?.source;
			if (typeof src === 'string') {
				numbersWithSource++;
				const issue = numberIssue(src, value);
				if (issue) numberIssues.push(issue);
			}
		}
		return value;
	};

	let parsed: unknown;
	try {
		parsed = JSON.parse(source, reviver);
	} catch {
		return {
			ok: false,
			error: 'Contenu JSON invalide (les commentaires ne sont pas acceptés).',
		};
	}

	if (!isPlainObject(parsed)) {
		return { ok: false, error: 'Le bloc doit contenir un objet JSON.' };
	}

	const duplicate = findDuplicateKey(source);
	if (duplicate !== null) {
		return { ok: false, error: `Clé en double : « ${duplicate} ».` };
	}

	if (containsProtoKey(parsed)) {
		return { ok: false, error: 'La clé « __proto__ » n’est pas acceptée.' };
	}

	const interpreted = interpretConfig(parsed);
	if (typeof interpreted === 'string') {
		return { ok: false, error: interpreted };
	}

	let editBlocker: string | null = null;
	if (numbers > numbersWithSource) {
		editBlocker =
			'Impossible de vérifier la précision des nombres de ce bloc : modification par formulaire désactivée.';
	} else if (numberIssues.length > 0) {
		editBlocker = `Ce bloc contient une valeur que le formulaire ne peut pas réécrire sans perte (${numberIssues.join(' ; ')}). Modifiez-le à la main.`;
	}

	return { ok: true, data: parsed, config: interpreted, editBlocker };
}

/** Problème de conservation d'un nombre écrit `src` et relu comme `value`, ou null. */
export function numberIssue(src: string, value: number): string | null {
	if (!Number.isFinite(value)) return `nombre hors limites : ${src}`;
	if (Object.is(value, -0)) return `valeur -0 : ${src}`;
	const match = /^-?(\d+)(?:\.(\d+))?(?:[eE][+-]?\d+)?$/.exec(src);
	if (!match) return `nombre non reconnu : ${src}`;
	const digits = ((match[1] ?? '') + (match[2] ?? ''))
		.replace(/^0+/, '')
		.replace(/0+$/, '');
	if (digits.length === 0) return null; // zéro écrit explicitement
	if (value === 0) return `nombre trop petit : ${src}`;
	if (digits.length > 15) return `nombre trop précis : ${src}`;
	return null;
}

/**
 * Cherche une clé en double dans un texte JSON déjà validé par JSON.parse.
 * Parcourt seulement chaînes et délimiteurs, avec un ensemble de clés par objet ouvert.
 * Les clés sont décodées (JSON.parse) : "type" et "type" sont identiques.
 */
export function findDuplicateKey(text: string): string | null {
	const stack: (Set<string> | null)[] = [];
	let i = 0;
	while (i < text.length) {
		const c = text[i];
		if (c === '{') {
			stack.push(new Set());
			i++;
		} else if (c === '[') {
			stack.push(null);
			i++;
		} else if (c === '}' || c === ']') {
			stack.pop();
			i++;
		} else if (c === '"') {
			let j = i + 1;
			while (j < text.length && text[j] !== '"') {
				if (text[j] === '\\') j++;
				j++;
			}
			const token = text.slice(i, j + 1);
			i = j + 1;
			let k = i;
			while (k < text.length && /[ \t\r\n]/.test(text[k] ?? '')) k++;
			const keys = stack[stack.length - 1];
			if (text[k] === ':' && keys) {
				const key = JSON.parse(token) as string;
				if (keys.has(key)) return key;
				keys.add(key);
			}
		} else {
			i++;
		}
	}
	return null;
}

function containsProtoKey(value: unknown): boolean {
	if (Array.isArray(value)) return value.some(containsProtoKey);
	if (value !== null && typeof value === 'object') {
		for (const key of Object.keys(value)) {
			if (key === '__proto__') return true;
			if (containsProtoKey((value as JsonObject)[key])) return true;
		}
	}
	return false;
}

function isPlainObject(value: unknown): value is JsonObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class FieldError extends Error {}

function has(data: JsonObject, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(data, key);
}

function getEnum<T extends string>(
	data: JsonObject,
	key: string,
	allowed: readonly T[],
	fallback: T,
): T {
	if (!has(data, key)) return fallback;
	const value = data[key];
	if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
		return value as T;
	}
	throw new FieldError(
		`Valeur non reconnue pour « ${key} » (attendu : ${allowed.join(', ')}).`,
	);
}

function getBool(data: JsonObject, key: string, fallback: boolean): boolean {
	if (!has(data, key)) return fallback;
	const value = data[key];
	if (typeof value === 'boolean') return value;
	throw new FieldError(`« ${key} » doit valoir true ou false.`);
}

function getString(data: JsonObject, key: string, fallback: string): string {
	if (!has(data, key)) return fallback;
	const value = data[key];
	if (typeof value === 'string') return value;
	throw new FieldError(`« ${key} » doit être un texte.`);
}

function getNumber(data: JsonObject, key: string, fallback: number): number {
	if (!has(data, key)) return fallback;
	const value = data[key];
	if (typeof value === 'number') return value;
	throw new FieldError(`« ${key} » doit être un nombre.`);
}

function getStringList(data: JsonObject, key: string): string[] {
	if (!has(data, key)) return [];
	const value = data[key];
	if (Array.isArray(value) && value.every((v): v is string => typeof v === 'string')) {
		return [...value];
	}
	throw new FieldError(`« ${key} » doit être une liste de textes.`);
}

/** Interprète un objet JSON en configuration, ou renvoie un message d'erreur. */
export function interpretConfig(data: JsonObject): WidgetConfig | string {
	try {
		const type = getEnum<WidgetType | ''>(
			data,
			'type',
			WIDGET_TYPES,
			'',
		);
		if (type === '') return 'Champ « type » manquant.';
		const size = getEnum(data, 'size', SIZES, 'medium');
		const align = getEnum(data, 'align', ALIGNS, 'center');
		switch (type) {
			case 'clock':
				return {
					type,
					hour12: getBool(data, 'hour12', false),
					seconds: getBool(data, 'seconds', false),
					size,
					align,
				};
			case 'countdown':
				return {
					type,
					title: getString(data, 'title', ''),
					target: getString(data, 'target', ''),
					size,
					align,
				};
			case 'quote':
				return {
					type,
					mode: getEnum(data, 'mode', QUOTE_MODES, 'fixed'),
					interval: getNumber(data, 'interval', DEFAULT_INTERVAL),
					quotes: getStringList(data, 'quotes'),
					size,
					align,
				};
		}
	} catch (e) {
		if (e instanceof FieldError) return e.message;
		throw e;
	}
}

/**
 * Validation des valeurs, commune au formulaire et à l'affichage.
 * `isValidTarget` est fourni par l'appelant (voir time.ts) pour garder ce fichier indépendant.
 */
export function validateConfig(
	config: WidgetConfig,
	isValidTarget: (target: string) => boolean,
): string | null {
	switch (config.type) {
		case 'clock':
			return null;
		case 'countdown':
			if (config.title.trim() === '') return 'Indiquez un titre.';
			if (!isValidTarget(config.target)) return 'Date ou heure d’échéance invalide.';
			return null;
		case 'quote': {
			const interval = intervalError(config.interval);
			if (interval) return interval;
			if (config.quotes.length === 0) return 'Ajoutez au moins une citation.';
			const empty = config.quotes.findIndex((q) => q.trim() === '');
			if (empty !== -1) return `La citation n° ${empty + 1} est vide.`;
			return null;
		}
	}
}

export function intervalError(interval: number): string | null {
	if (
		!Number.isInteger(interval) ||
		interval < MIN_INTERVAL ||
		interval > MAX_INTERVAL
	) {
		return `L’intervalle doit être un nombre entier de secondes entre ${MIN_INTERVAL} et ${MAX_INTERVAL}.`;
	}
	return null;
}

/** Indice de la citation à afficher au pas `tick`, ou -1 si la liste est vide. */
export function quoteIndex(config: QuoteConfig, tick: number): number {
	const count = config.quotes.length;
	if (count === 0) return -1;
	if (config.mode === 'fixed') return 0;
	return ((tick % count) + count) % count;
}

/**
 * Écrit le JSON d'un bloc : les champs connus prennent les valeurs de `config`,
 * les autres champs de `data` sont conservés à leur place, les champs connus absents sont ajoutés.
 * La mise en forme est normalisée (indentation de 2 espaces).
 */
export function serializeBlock(data: JsonObject, config: WidgetConfig): string {
	const known = knownFields(config);
	const out: JsonObject = {};
	for (const key of Object.keys(data)) {
		out[key] = has(known, key) ? known[key] : data[key];
	}
	for (const key of Object.keys(known)) {
		if (!has(out, key)) out[key] = known[key];
	}
	return JSON.stringify(out, null, 2);
}

/** Bloc complet, délimiteurs compris. */
export function buildBlock(json: string): string {
	return '```' + LANG + '\n' + json + '\n```';
}
