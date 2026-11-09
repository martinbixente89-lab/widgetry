import { MarkdownPostProcessorContext, MarkdownRenderChild, MarkdownView, Notice, Plugin, setIcon } from 'obsidian';
import { LANG, readBlock } from './format';
import { WidgetModal } from './modal';
import { prepareEdit } from './note-write';
import { renderError, renderWidget } from './widgets';

export default class WidgetryPlugin extends Plugin {
	onload(): void {
		this.registerMarkdownCodeBlockProcessor(LANG, (source, el, ctx) => this.renderBlock(source, el, ctx));

		this.addCommand({
			id: 'insert-widget',
			name: 'Insérer un widget',
			editorCheckCallback: (checking, _editor, ctx) => {
				if (!(ctx instanceof MarkdownView) || !ctx.file) return false;
				if (!checking) {
					new WidgetModal(this.app, { kind: 'insert', view: ctx, path: ctx.file.path }).open();
				}
				return true;
			},
		});
	}

	private renderBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		// Le composant enfant est déchargé par Obsidian quand le bloc disparaît : ses minuteries s'arrêtent.
		const child = new MarkdownRenderChild(el);
		ctx.addChild(child);
		el.addClass('widgetry-host');

		const result = readBlock(source);
		const body = el.createDiv();
		if (result.ok) renderWidget(body, result.config, child);
		else renderError(body, result.error);

		const button = el.createEl('button', {
			cls: ['clickable-icon', 'widgetry-edit'],
			attr: { 'aria-label': 'Modifier le widget', type: 'button' },
		});
		setIcon(button, 'pencil');
		child.registerDomEvent(button, 'click', (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			if (!result.ok) {
				new Notice(`Widgetry : ce bloc ne peut pas être modifié par le formulaire. ${result.error}`);
				return;
			}
			if (result.editBlocker) {
				new Notice(`Widgetry : ${result.editBlocker}`);
				return;
			}
			const target = prepareEdit(this.app, el, ctx, source);
			if (typeof target === 'string') {
				new Notice(`Widgetry : ${target}`);
				return;
			}
			new WidgetModal(this.app, {
				kind: 'edit',
				target,
				data: result.data,
				config: result.config,
			}).open();
		});
	}
}
