import { describe, expect, it } from 'vitest';
import {
	buildBlock,
	findDuplicateKey,
	interpretConfig,
	intervalError,
	numberIssue,
	quoteIndex,
	readBlock,
	serializeBlock,
	validateConfig,
	type QuoteConfig,
	type WidgetConfig,
} from '../src/format';
import { isValidInstant } from '../src/time';

const valid = (c: WidgetConfig) => validateConfig(c, isValidInstant);

function quote(partial: Partial<QuoteConfig>): QuoteConfig {
	return {
		type: 'quote',
		mode: 'rotate',
		interval: 30,
		quotes: ['a', 'b', 'c'],
		size: 'medium',
		align: 'center',
		...partial,
	};
}

function read(source: string) {
	const r = readBlock(source);
	if (!r.ok) throw new Error(r.error);
	return r;
}

describe('lecture des blocs', () => {
	it('lit un bloc horloge minimal avec les valeurs par défaut', () => {
		const r = read('{"type":"clock"}');
		expect(r.config).toEqual({
			type: 'clock',
			hour12: false,
			seconds: false,
			size: 'medium',
			align: 'center',
		});
		expect(r.editBlocker).toBeNull();
	});

	it('refuse un JSON invalide, y compris avec commentaires', () => {
		expect(readBlock('{"type":"clock",}').ok).toBe(false);
		expect(readBlock('{"type":"clock"} // note').ok).toBe(false);
		expect(readBlock('{\n  // note\n  "type":"clock"\n}').ok).toBe(false);
	});

	it('refuse un contenu qui n’est pas un objet', () => {
		expect(readBlock('[1,2]').ok).toBe(false);
		expect(readBlock('"clock"').ok).toBe(false);
		expect(readBlock('null').ok).toBe(false);
	});

	it('refuse un type inconnu ou manquant', () => {
		expect(readBlock('{"type":"weather"}').ok).toBe(false);
		expect(readBlock('{"size":"small"}').ok).toBe(false);
	});

	it('refuse un champ connu du mauvais type', () => {
		expect(readBlock('{"type":"quote","interval":"30"}').ok).toBe(false);
		expect(readBlock('{"type":"quote","quotes":"a"}').ok).toBe(false);
		expect(readBlock('{"type":"quote","quotes":["a",1]}').ok).toBe(false);
		expect(readBlock('{"type":"clock","seconds":"yes"}').ok).toBe(false);
		expect(readBlock('{"type":"clock","size":"huge"}').ok).toBe(false);
	});

	it('refuse la clé __proto__, même imbriquée', () => {
		expect(readBlock('{"type":"clock","__proto__":{}}').ok).toBe(false);
		expect(readBlock('{"type":"clock","x":{"__proto__":1}}').ok).toBe(false);
	});

	it('accepte un ordre et des espaces quelconques', () => {
		const r = read('  {\n"align" : "left",\t"type":"clock" ,"seconds":true}\n');
		expect(r.config).toMatchObject({ type: 'clock', align: 'left', seconds: true });
	});
});

describe('clés en double', () => {
	it('détecte un doublon simple', () => {
		expect(findDuplicateKey('{"a":1,"a":2}')).toBe('a');
	});
	it('détecte un doublon dans un objet imbriqué', () => {
		expect(findDuplicateKey('{"a":{"b":1,"c":[{"d":1,"d":2}]}}')).toBe('d');
	});
	it('détecte un doublon écrit avec un échappement', () => {
		expect(findDuplicateKey('{"type":1,"\\u0074ype":2}')).toBe('type');
	});
	it('autorise la même clé dans deux objets différents', () => {
		expect(findDuplicateKey('{"a":{"x":1},"b":{"x":2},"c":[{"x":1},{"x":2}]}')).toBeNull();
	});
	it('ignore un texte ressemblant à une clé dans une valeur', () => {
		expect(findDuplicateKey('{"a":"\\"a\\": 1","b":["a:","a"]}')).toBeNull();
	});
	it('fait refuser le bloc', () => {
		const r = readBlock('{"type":"clock","type":"quote"}');
		expect(r.ok).toBe(false);
	});
});

describe('précision des nombres', () => {
	it('accepte les nombres ordinaires', () => {
		expect(numberIssue('30', 30)).toBeNull();
		expect(numberIssue('1.0', 1)).toBeNull();
		expect(numberIssue('1E2', 100)).toBeNull();
		expect(numberIssue('0', 0)).toBeNull();
		expect(numberIssue('0.000', 0)).toBeNull();
		expect(numberIssue('123456789012345', 123456789012345)).toBeNull();
		expect(numberIssue('1000000000000000000000', 1e21)).toBeNull();
	});
	it('signale les nombres trop précis', () => {
		expect(numberIssue('12345678901234567890', 12345678901234567000)).not.toBeNull();
		expect(numberIssue('0.1234567890123456', 0.1234567890123456)).not.toBeNull();
	});
	it('signale les nombres hors limites et -0', () => {
		expect(numberIssue('1e400', Infinity)).not.toBeNull();
		expect(numberIssue('1e-400', 0)).not.toBeNull();
		expect(numberIssue('-0', -0)).not.toBeNull();
		expect(numberIssue('-0.0', -0)).not.toBeNull();
		expect(numberIssue('-0e5', -0)).not.toBeNull();
	});
	it('bloque la modification par formulaire, y compris pour un champ inconnu', () => {
		for (const n of ['12345678901234567890', '1e400', '1e-400', '-0', '-0.0', '-0e5']) {
			const r = read(`{"type":"clock","extra":{"n":[${n}]}}`);
			expect(r.editBlocker, n).not.toBeNull();
		}
	});
	it('n’entrave pas un bloc aux nombres ordinaires', () => {
		expect(read('{"type":"quote","interval":30,"quotes":["a"],"x":1.5}').editBlocker).toBeNull();
	});
});

describe('écriture des blocs', () => {
	it('conserve les champs inconnus et leur place', () => {
		const r = read('{"note":"garder","type":"clock","extra":{"a":[1,true,null]},"seconds":false}');
		const out = serializeBlock(r.data, { ...(r.config as Extract<WidgetConfig, { type: 'clock' }>), seconds: true });
		const parsed = JSON.parse(out) as Record<string, unknown>;
		expect(Object.keys(parsed)).toEqual(['note', 'type', 'extra', 'seconds', 'hour12', 'size', 'align']);
		expect(parsed.note).toBe('garder');
		expect(parsed.extra).toEqual({ a: [1, true, null] });
		expect(parsed.seconds).toBe(true);
	});

	it('normalise la mise en forme', () => {
		const out = serializeBlock({}, { type: 'clock', hour12: true, seconds: false, size: 'small', align: 'left' });
		expect(out).toBe(
			'{\n  "type": "clock",\n  "hour12": true,\n  "seconds": false,\n  "size": "small",\n  "align": "left"\n}',
		);
	});

	it('fait l’aller-retour des citations multilignes et caractères spéciaux', () => {
		const quotes = [
			'Première ligne\nseconde ligne\n\ntroisième',
			'« Guillemets » "droits" \'simples\' et barre \\ oblique',
			'Accents éàü, emoji 🌍🧭, tabulation\tici',
			'Dièse # et deux-points : et accolades {"a":1}',
			'Ligne avec ``` au milieu\n```\n~~~\n````widgetry',
			'```',
			'  espaces en tête et en fin  ',
			'  séparateurs   Unicode',
		];
		const config = quote({ quotes });
		const json = serializeBlock({}, config);
		const r = read(json);
		expect((r.config as QuoteConfig).quotes).toEqual(quotes);
		expect(r.editBlocker).toBeNull();
		// Aucune ligne produite ne peut fermer le bloc Markdown.
		for (const line of json.split('\n')) {
			expect(line).not.toMatch(/^\s*(`{3,}|~{3,})/);
		}
		// Le bloc complet ne contient qu'une ouverture et une fermeture.
		const block = buildBlock(json);
		expect(block.split('\n').filter((l) => /^(`{3,}|~{3,})/.test(l))).toEqual(['```widgetry', '```']);
	});
});

describe('citations', () => {
	it('citation fixe : toujours la première, les autres sont conservées', () => {
		const c = quote({ mode: 'fixed', quotes: ['un', 'deux'] });
		expect([0, 1, 2, 7].map((t) => quoteIndex(c, t))).toEqual([0, 0, 0, 0]);
		expect((read(serializeBlock({}, c)).config as QuoteConfig).quotes).toEqual(['un', 'deux']);
	});

	it('rotation dans l’ordre de la liste, puis retour au début', () => {
		const c = quote({ quotes: ['a', 'b', 'c'] });
		expect([0, 1, 2, 3, 4, 5].map((t) => quoteIndex(c, t))).toEqual([0, 1, 2, 0, 1, 2]);
	});

	it('une liste d’un seul élément reste stable', () => {
		const c = quote({ quotes: ['seule'] });
		expect([0, 1, 2].map((t) => quoteIndex(c, t))).toEqual([0, 0, 0]);
	});

	it('liste vide : refusée par la validation, -1 à l’affichage', () => {
		const c = quote({ quotes: [] });
		expect(valid(c)).not.toBeNull();
		expect(quoteIndex(c, 0)).toBe(-1);
		const r = read('{"type":"quote"}');
		expect((r.config as QuoteConfig).quotes).toEqual([]);
		expect(valid(r.config)).not.toBeNull();
	});

	it('citation vide ou blanche : refusée, sans être supprimée', () => {
		expect(valid(quote({ quotes: ['a', ''] }))).toContain('2');
		expect(valid(quote({ quotes: ['  \n\t'] }))).not.toBeNull();
		const r = read('{"type":"quote","quotes":["a",""]}');
		expect((r.config as QuoteConfig).quotes).toEqual(['a', '']);
	});

	it('validation de l’intervalle', () => {
		for (const ok of [5, 30, 86400]) expect(intervalError(ok), String(ok)).toBeNull();
		for (const bad of [0, -5, 4, 2.5, NaN, Infinity, 86401]) {
			expect(intervalError(bad), String(bad)).not.toBeNull();
		}
		expect(valid(quote({ interval: 2 }))).not.toBeNull();
		expect(interpretConfig({ type: 'quote', interval: 'abc' })).toBeTypeOf('string');
	});
});

describe('compte à rebours', () => {
	it('exige un titre et une échéance valide', () => {
		const base = { type: 'countdown', size: 'medium', align: 'center' } as const;
		expect(valid({ ...base, title: '', target: '2026-12-20T18:00:00+01:00' })).not.toBeNull();
		expect(valid({ ...base, title: 'A', target: '2026-12-20 18:00' })).not.toBeNull();
		expect(valid({ ...base, title: 'A', target: '2026-12-20T18:00:00+01:00' })).toBeNull();
	});
});
