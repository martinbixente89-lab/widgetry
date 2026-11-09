import { describe, expect, it } from 'vitest';
import { applyPlan, insertionText, lineSpans, planBlockReplacement } from '../src/note-edit';

const OLD = '{"type":"clock"}';
const NEW = '{\n  "type": "clock",\n  "seconds": true\n}';

function replace(text: string, lineStart: number, lineEnd: number, expected = OLD, next = NEW): string {
	const plan = planBlockReplacement(text, lineStart, lineEnd, expected, next);
	if (!plan.ok) throw new Error(plan.reason);
	return applyPlan(text, plan);
}

describe('remplacement vérifié d’un bloc', () => {
	it('remplace seulement le contenu intérieur, octet par octet ailleurs', () => {
		const before = '# Titre\n\nAvant le bloc.\n';
		const after = '\nAprès le bloc.\n';
		const text = `${before}\`\`\`widgetry\n${OLD}\n\`\`\`${after}`;
		const out = replace(text, 3, 5);
		expect(out).toBe(`${before}\`\`\`widgetry\n${NEW}\n\`\`\`${after}`);
		expect(out.startsWith(before)).toBe(true);
		expect(out.endsWith('```' + after)).toBe(true);
	});

	it('ne touche que le bon bloc quand plusieurs blocs identiques existent', () => {
		const block = '```widgetry\n' + OLD + '\n```';
		const text = [block, 'milieu', block, 'fin'].join('\n');
		const out = replace(text, 4, 6);
		expect(out).toBe([block, 'milieu', '```widgetry\n' + NEW + '\n```', 'fin'].join('\n'));
	});

	it('fonctionne au tout début et à la toute fin de la note', () => {
		const text = '```widgetry\n' + OLD + '\n```';
		expect(replace(text, 0, 2)).toBe('```widgetry\n' + NEW + '\n```');
	});

	it('conserve les fins de ligne Windows (CRLF)', () => {
		const text = 'a\r\n```widgetry\r\n' + OLD + '\r\n```\r\nb\r\n';
		const out = replace(text, 1, 3);
		expect(out).toBe('a\r\n```widgetry\r\n' + NEW.split('\n').join('\r\n') + '\r\n```\r\nb\r\n');
	});

	it('conserve les fins de ligne Unix (LF)', () => {
		const out = replace('```widgetry\n' + OLD + '\n```\n', 0, 2);
		expect(out).not.toContain('\r');
	});

	it('remplit un bloc vide', () => {
		const out = replace('x\n```widgetry\n```\ny', 1, 2, '');
		expect(out).toBe('x\n```widgetry\n' + NEW + '\n```\ny');
	});

	it('accepte les délimiteurs ~~~ et plus longs', () => {
		expect(replace('~~~widgetry\n' + OLD + '\n~~~', 0, 2)).toBe('~~~widgetry\n' + NEW + '\n~~~');
		expect(replace('````widgetry\n' + OLD + '\n`````', 0, 2)).toBe('````widgetry\n' + NEW + '\n`````');
	});

	it('refuse si le contenu a changé', () => {
		const text = '```widgetry\n{"type":"quote"}\n```';
		expect(planBlockReplacement(text, 0, 2, OLD, NEW).ok).toBe(false);
	});

	it('refuse si les lignes ne sont plus à la bonne position', () => {
		const text = 'nouvelle ligne\n```widgetry\n' + OLD + '\n```';
		expect(planBlockReplacement(text, 0, 2, OLD, NEW).ok).toBe(false);
		expect(planBlockReplacement(text, 1, 5, OLD, NEW).ok).toBe(false);
		expect(planBlockReplacement(text, 3, 1, OLD, NEW).ok).toBe(false);
	});

	it('refuse un autre langage ou un délimiteur indenté', () => {
		expect(planBlockReplacement('```json\n' + OLD + '\n```', 0, 2, OLD, NEW).ok).toBe(false);
		expect(planBlockReplacement('  ```widgetry\n' + OLD + '\n  ```', 0, 2, OLD, NEW).ok).toBe(false);
		expect(planBlockReplacement('> ```widgetry\n> ' + OLD + '\n> ```', 0, 2, OLD, NEW).ok).toBe(false);
	});

	it('refuse un délimiteur de fermeture incompatible', () => {
		expect(planBlockReplacement('```widgetry\n' + OLD + '\n~~~', 0, 2, OLD, NEW).ok).toBe(false);
		expect(planBlockReplacement('````widgetry\n' + OLD + '\n```', 0, 2, OLD, NEW).ok).toBe(false);
		expect(planBlockReplacement('```widgetry\n' + OLD + '\n``` x', 0, 2, OLD, NEW).ok).toBe(false);
	});

	it('compare le contenu attendu sans tenir compte des fins de ligne', () => {
		const text = '```widgetry\r\n{\r\n"type":"clock"\r\n}\r\n```';
		expect(planBlockReplacement(text, 0, 4, '{\n"type":"clock"\n}', NEW).ok).toBe(true);
		expect(planBlockReplacement(text, 0, 4, '{\n"type":"clock"\n}\n', NEW).ok).toBe(true);
	});
});

describe('insertion', () => {
	const block = '```widgetry\n{}\n```';
	it('ligne vide : insère le bloc seul', () => {
		expect(insertionText('', 0, block)).toBe(block);
	});
	it('au milieu d’une ligne : place le bloc sur ses propres lignes', () => {
		expect(insertionText('avant après', 6, block)).toBe('\n' + block + '\n');
	});
	it('en fin de ligne : retour à la ligne avant seulement', () => {
		expect(insertionText('texte', 5, block)).toBe('\n' + block);
	});
	it('en début de ligne non vide : retour à la ligne après seulement', () => {
		expect(insertionText('texte', 0, block)).toBe(block + '\n');
	});
	it('le texte existant reste intact', () => {
		const line = 'avant après';
		const inserted = insertionText(line, 6, block);
		const result = line.slice(0, 6) + inserted + line.slice(6);
		expect(result.replace('\n' + block + '\n', '')).toBe(line);
	});
});

describe('découpage en lignes', () => {
	it('distingue LF, CRLF et dernière ligne', () => {
		expect(lineSpans('a\r\nb\nc')).toEqual([
			{ start: 0, end: 1, next: 3 },
			{ start: 3, end: 4, next: 5 },
			{ start: 5, end: 6, next: 6 },
		]);
		expect(lineSpans('')).toEqual([{ start: 0, end: 0, next: 0 }]);
	});
});
