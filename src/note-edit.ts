// Calculs de modification du texte des notes : vérification et remplacement d'un bloc, insertion.
// Ce fichier n'importe pas `obsidian` : il est testé directement avec Vitest.
// Il ne modifie rien lui-même : il calcule une plage et un texte, ou un refus.

import { LANG } from './format';

interface LineSpan {
	/** Début de la ligne. */
	start: number;
	/** Fin du contenu, sans le retour à la ligne. */
	end: number;
	/** Début de la ligne suivante. */
	next: number;
}

export function lineSpans(text: string): LineSpan[] {
	const spans: LineSpan[] = [];
	let start = 0;
	for (;;) {
		const nl = text.indexOf('\n', start);
		if (nl === -1) {
			spans.push({ start, end: text.length, next: text.length });
			return spans;
		}
		const end = nl > start && text[nl - 1] === '\r' ? nl - 1 : nl;
		spans.push({ start, end, next: nl + 1 });
		start = nl + 1;
	}
}

export type Plan =
	| { ok: true; from: number; to: number; insert: string }
	| { ok: false; reason: string };

const OPEN_FENCE = /^(`{3,}|~{3,})(.*)$/;

function fail(reason: string): Plan {
	return { ok: false, reason };
}

/**
 * Prépare le remplacement du contenu d'un bloc `widgetry` situé entre les lignes
 * `lineStart` (délimiteur d'ouverture) et `lineEnd` (délimiteur de fermeture), numérotées depuis 0.
 * Refuse si la position ou le contenu ne correspondent pas exactement à ce qui est attendu.
 * Seules les lignes intérieures sont remplacées ; les délimiteurs restent intacts.
 */
export function planBlockReplacement(
	text: string,
	lineStart: number,
	lineEnd: number,
	expectedInner: string,
	newInner: string,
): Plan {
	const lines = lineSpans(text);
	const open = lines[lineStart];
	const close = lines[lineEnd];
	if (!open || !close || lineEnd <= lineStart) {
		return fail('La position du bloc ne correspond plus à la note.');
	}

	const openMatch = OPEN_FENCE.exec(text.slice(open.start, open.end));
	const fence = openMatch?.[1];
	if (!openMatch || !fence || (openMatch[2] ?? '').trim() !== LANG) {
		return fail('Le délimiteur d’ouverture du bloc n’est plus à la position attendue.');
	}
	const fenceChar = fence[0] ?? '`';
	const closeText = text.slice(close.start, close.end);
	const closeMatch = /^(`{3,}|~{3,})[ \t]*$/.exec(closeText);
	const closeFence = closeMatch?.[1];
	if (!closeFence || closeFence[0] !== fenceChar || closeFence.length < fence.length) {
		return fail('Le délimiteur de fermeture du bloc n’est plus à la position attendue.');
	}

	const inner = lines
		.slice(lineStart + 1, lineEnd)
		.map((l) => text.slice(l.start, l.end))
		.join('\n');
	const expected = expectedInner.replace(/\r\n/g, '\n').replace(/\n$/, '');
	if (inner !== expected) {
		return fail('Le contenu du bloc a changé depuis l’ouverture du formulaire.');
	}

	const eol = text.slice(open.end, open.next) || '\n';
	const insert = newInner.split('\n').join(eol);
	const first = lines[lineStart + 1];
	const last = lines[lineEnd - 1];
	if (lineEnd === lineStart + 1 || !first || !last) {
		return { ok: true, from: close.start, to: close.start, insert: insert + eol };
	}
	return { ok: true, from: first.start, to: last.end, insert };
}

export function applyPlan(text: string, plan: { from: number; to: number; insert: string }): string {
	return text.slice(0, plan.from) + plan.insert + text.slice(plan.to);
}

/**
 * Texte à insérer au curseur (colonne `ch` de la ligne `lineText`) pour que le bloc
 * occupe ses propres lignes, sans modifier le texte existant.
 */
export function insertionText(lineText: string, ch: number, block: string): string {
	const before = lineText.slice(0, ch);
	const after = lineText.slice(ch);
	return (before.length > 0 ? '\n' : '') + block + (after.length > 0 ? '\n' : '');
}
