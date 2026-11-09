// Écriture protégée dans les notes : choisit la voie Editor, la voie Vault.process ou un refus.
// Toute modification est précédée d'une vérification du fichier, de la position et du contenu exact.

import { App, MarkdownPostProcessorContext, MarkdownView, TFile } from 'obsidian';
import { applyPlan, insertionText, planBlockReplacement } from './note-edit';

/** Contexte noté à l'ouverture du formulaire de modification. */
export interface EditTarget {
	el: HTMLElement;
	ctx: MarkdownPostProcessorContext;
	sourcePath: string;
	/** Contenu exact du bloc reçu par le rendu. */
	originalInner: string;
	/** Panneau qui affiche le widget. */
	view: MarkdownView;
}

class Refusal extends Error {}

/** Panneau de note qui contient l'élément, ou null (note intégrée, aperçu au survol, Canvas…). */
export function findOwnerView(app: App, el: HTMLElement): MarkdownView | null {
	let owner: MarkdownView | null = null;
	app.workspace.iterateAllLeaves((leaf) => {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.containerEl.contains(el)) owner = view;
	});
	return owner;
}

/** Prépare une modification, ou renvoie la raison du refus. */
export function prepareEdit(
	app: App,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	source: string,
): EditTarget | string {
	const view = findOwnerView(app, el);
	if (!view || !view.file || view.file.path !== ctx.sourcePath) {
		return 'Ce widget ne peut être modifié que depuis sa propre note (pas depuis une note intégrée ou un aperçu).';
	}
	if (!ctx.getSectionInfo(el)) {
		return 'Obsidian ne fournit pas la position de ce widget : modification impossible ici.';
	}
	return { el, ctx, sourcePath: ctx.sourcePath, originalInner: source, view };
}

function isViewAlive(app: App, view: MarkdownView): boolean {
	let alive = false;
	app.workspace.iterateAllLeaves((leaf) => {
		if (leaf.view === view) alive = true;
	});
	return alive;
}

function openInEditModeElsewhere(app: App, path: string, except: MarkdownView): boolean {
	let found = false;
	app.workspace.iterateAllLeaves((leaf) => {
		const view = leaf.view;
		if (
			view instanceof MarkdownView &&
			view !== except &&
			view.file?.path === path &&
			view.getMode() === 'source'
		) {
			found = true;
		}
	});
	return found;
}

/**
 * Remplace le contenu du bloc. Renvoie null en cas de succès, sinon la raison du refus.
 * Aucune écriture n'a lieu en cas de refus.
 */
export async function saveEdit(app: App, target: EditTarget, newInner: string): Promise<string | null> {
	if (!target.el.isConnected) {
		return 'Le widget a été réaffiché entre-temps. Fermez le formulaire et recommencez.';
	}
	const info = target.ctx.getSectionInfo(target.el);
	if (!info) return 'Obsidian ne fournit plus la position de ce widget.';

	const { view } = target;
	if (!isViewAlive(app, view) || !(view.file instanceof TFile) || view.file.path !== target.sourcePath) {
		return 'Le panneau d’origine n’affiche plus cette note.';
	}

	if (view.getMode() === 'source') {
		// Voie Editor : le contenu de l'éditeur fait foi.
		const editor = view.editor;
		const plan = planBlockReplacement(
			editor.getValue(),
			info.lineStart,
			info.lineEnd,
			target.originalInner,
			newInner,
		);
		if (!plan.ok) return plan.reason;
		editor.replaceRange(plan.insert, editor.offsetToPos(plan.from), editor.offsetToPos(plan.to));
		return null;
	}

	// Mode lecture.
	if (openInEditModeElsewhere(app, target.sourcePath, view)) {
		return 'Cette note est ouverte en édition dans un autre panneau : modifiez le widget depuis ce panneau.';
	}
	try {
		await app.vault.process(view.file, (data) => {
			const plan = planBlockReplacement(
				data,
				info.lineStart,
				info.lineEnd,
				target.originalInner,
				newInner,
			);
			if (!plan.ok) throw new Refusal(plan.reason);
			return applyPlan(data, plan);
		});
	} catch (e) {
		if (e instanceof Refusal) return e.message;
		return `Échec de l’écriture : ${e instanceof Error ? e.message : String(e)}`;
	}
	return null;
}

/** Insère un bloc au curseur. Renvoie null en cas de succès, sinon la raison du refus. */
export function insertBlock(app: App, view: MarkdownView, expectedPath: string, block: string): string | null {
	if (!isViewAlive(app, view) || view.file?.path !== expectedPath) {
		return 'Le panneau d’origine n’affiche plus cette note.';
	}
	if (view.getMode() !== 'source') return 'Passez la note en mode édition pour insérer un widget.';
	const editor = view.editor;
	if (editor.somethingSelected()) {
		return 'Du texte est sélectionné : désélectionnez-le pour insérer le widget sans le remplacer.';
	}
	const cursor = editor.getCursor();
	const text = insertionText(editor.getLine(cursor.line), cursor.ch, block);
	editor.replaceRange(text, cursor);
	return null;
}
