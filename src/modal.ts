// Fenêtre de personnalisation avec aperçu, pour l'insertion et la modification d'un widget.

import { App, Component, MarkdownView, Modal, Notice, Setting } from 'obsidian';
import {
	ALIGNS,
	buildBlock,
	defaultConfig,
	MAX_INTERVAL,
	MIN_INTERVAL,
	QUOTE_MODES,
	serializeBlock,
	SIZES,
	validateConfig,
	WIDGET_TYPES,
	type Align,
	type JsonObject,
	type QuoteMode,
	type Size,
	type WidgetConfig,
	type WidgetType,
} from './format';
import { insertBlock, saveEdit, type EditTarget } from './note-write';
import { formatInstant, instantToLocalFields, isValidInstant, localToInstant, parseInstant } from './time';
import { renderError, renderWidget } from './widgets';

export type ModalMode =
	| { kind: 'insert'; view: MarkdownView; path: string }
	| { kind: 'edit'; target: EditTarget; data: JsonObject; config: WidgetConfig };

const TYPE_LABELS: Record<WidgetType, string> = {
	clock: 'Horloge',
	countdown: 'Compte à rebours',
	quote: 'Citations',
};
const SIZE_LABELS: Record<Size, string> = { small: 'Petite', medium: 'Moyenne', large: 'Grande' };
const ALIGN_LABELS: Record<Align, string> = { left: 'Gauche', center: 'Centre', right: 'Droite' };
const MODE_LABELS: Record<QuoteMode, string> = { fixed: 'Citation fixe', rotate: 'Rotation de la liste' };

const TARGET_ERRORS = {
	invalid: 'Date ou heure invalide.',
	nonexistent: 'Cette heure n’existe pas ce jour-là (passage à l’heure d’été). Choisissez une autre heure.',
	ambiguous: 'Cette heure existe deux fois ce jour-là (retour à l’heure d’hiver). Choisissez une autre heure.',
};

export class WidgetModal extends Modal {
	private config: WidgetConfig;
	private readonly data: JsonObject;
	private previewOwner: Component | null = null;
	private fieldsEl!: HTMLElement;
	private previewEl!: HTMLElement;
	private errorEl!: HTMLElement;
	private submitting = false;

	// Compte à rebours : champs locaux du formulaire.
	private cdDate = '';
	private cdTime = '';
	private cdDirty = false;

	constructor(
		app: App,
		private readonly mode: ModalMode,
	) {
		super(app);
		if (mode.kind === 'edit') {
			this.config = structuredClone(mode.config);
			this.data = mode.data;
		} else {
			this.config = defaultConfig('clock');
			this.data = {};
		}
		this.initCountdownFields();
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		titleEl.setText(this.mode.kind === 'insert' ? 'Insérer un widget' : 'Modifier le widget');
		contentEl.addClass('widgetry-modal');

		if (this.mode.kind === 'insert') {
			new Setting(contentEl).setName('Type de widget').addDropdown((dd) => {
				for (const type of WIDGET_TYPES) dd.addOption(type, TYPE_LABELS[type]);
				dd.setValue(this.config.type).onChange((value) => {
					const { size, align } = this.config;
					this.config = { ...defaultConfig(value as WidgetType), size, align };
					this.initCountdownFields();
					this.changed(true);
				});
			});
		}

		this.fieldsEl = contentEl.createDiv();
		contentEl.createEl('h4', { text: 'Aperçu' });
		this.previewEl = contentEl.createDiv({ cls: 'widgetry-preview' });
		this.errorEl = contentEl.createDiv({ cls: 'widgetry-form-error' });

		new Setting(contentEl)
			.addButton((b) => b.setButtonText('Annuler').onClick(() => this.close()))
			.addButton((b) =>
				b
					.setCta()
					.setButtonText(this.mode.kind === 'insert' ? 'Insérer' : 'Enregistrer')
					.onClick(() => void this.submit()),
			);

		this.renderFields();
		this.refreshPreview();
	}

	onClose(): void {
		this.previewOwner?.unload();
		this.previewOwner = null;
		this.contentEl.empty();
	}

	private initCountdownFields(): void {
		this.cdDirty = false;
		if (this.config.type !== 'countdown') return;
		const ms = parseInstant(this.config.target);
		if (ms !== null) {
			const fields = instantToLocalFields(ms);
			this.cdDate = fields.date;
			this.cdTime = fields.time;
		} else {
			const inAWeek = instantToLocalFields(Date.now() + 7 * 86_400_000);
			this.cdDate = inAWeek.date;
			this.cdTime = '09:00';
			this.cdDirty = true;
		}
	}

	private renderFields(): void {
		const el = this.fieldsEl;
		el.empty();
		// `config` est la copie de travail : les champs la modifient directement.
		const config = this.config;

		switch (config.type) {
			case 'clock':
				new Setting(el).setName('Format 12 h').addToggle((t) =>
					t.setValue(config.hour12).onChange((v) => {
						config.hour12 = v;
						this.changed();
					}),
				);
				new Setting(el).setName('Afficher les secondes').addToggle((t) =>
					t.setValue(config.seconds).onChange((v) => {
						config.seconds = v;
						this.changed();
					}),
				);
				break;

			case 'countdown':
				new Setting(el).setName('Titre').addText((t) =>
					t.setValue(config.title).onChange((v) => {
						config.title = v;
						this.changed();
					}),
				);
				new Setting(el)
					.setName('Échéance')
					.setDesc('Date et heure de cet ordinateur, enregistrées comme un instant absolu.')
					.addText((t) => {
						t.inputEl.type = 'date';
						t.setValue(this.cdDate).onChange((v) => {
							this.cdDate = v;
							this.cdDirty = true;
							this.changed();
						});
					})
					.addText((t) => {
						t.inputEl.type = 'time';
						t.setValue(this.cdTime).onChange((v) => {
							this.cdTime = v;
							this.cdDirty = true;
							this.changed();
						});
					});
				break;

			case 'quote': {
				new Setting(el).setName('Mode').addDropdown((dd) => {
					for (const m of QUOTE_MODES) dd.addOption(m, MODE_LABELS[m]);
					dd.setValue(config.mode).onChange((v) => {
						config.mode = v as QuoteMode;
						this.changed(true);
					});
				});
				if (config.mode === 'rotate') {
					new Setting(el)
						.setName('Intervalle (secondes)')
						.setDesc(`Nombre entier entre ${MIN_INTERVAL} et ${MAX_INTERVAL}.`)
						.addText((t) => {
							t.inputEl.type = 'number';
							t.setValue(String(config.interval)).onChange((v) => {
								config.interval = v.trim() === '' ? NaN : Number(v);
								this.changed();
							});
						});
				} else if (config.quotes.length > 1) {
					el.createDiv({
						cls: 'setting-item-description',
						text: 'En mode fixe, seule la première citation est affichée. Les autres restent enregistrées.',
					});
				}
				config.quotes.forEach((q, i) => {
					new Setting(el)
						.setName(`Citation ${i + 1}`)
						.addTextArea((ta) => {
							ta.inputEl.addClass('widgetry-quote-input');
							ta.setValue(q).onChange((v) => {
								config.quotes[i] = v;
								this.changed();
							});
						})
						.addExtraButton((b) =>
							b
								.setIcon('trash')
								.setTooltip('Retirer cette citation')
								.onClick(() => {
									config.quotes.splice(i, 1);
									this.changed(true);
								}),
						);
				});
				new Setting(el).addButton((b) =>
					b.setButtonText('Ajouter une citation').onClick(() => {
						config.quotes.push('');
						this.changed(true);
					}),
				);
				break;
			}
		}

		new Setting(el).setName('Taille').addDropdown((dd) => {
			for (const s of SIZES) dd.addOption(s, SIZE_LABELS[s]);
			dd.setValue(config.size).onChange((v) => {
				config.size = v as Size;
				this.changed();
			});
		});
		new Setting(el).setName('Alignement').addDropdown((dd) => {
			for (const a of ALIGNS) dd.addOption(a, ALIGN_LABELS[a]);
			dd.setValue(config.align).onChange((v) => {
				config.align = v as Align;
				this.changed();
			});
		});
	}

	/** Met à jour l'aperçu ; reconstruit les champs si leur liste change. */
	private changed(rerenderFields = false): void {
		if (rerenderFields) this.renderFields();
		this.refreshPreview();
	}

	/** Configuration finale, ou message d'erreur. */
	private currentConfig(): WidgetConfig | string {
		const config = this.config;
		if (config.type === 'countdown' && this.cdDirty) {
			const r = localToInstant(this.cdDate, this.cdTime);
			if (!r.ok) return TARGET_ERRORS[r.reason];
			return { ...config, target: formatInstant(r.ms, r.offset) };
		}
		return config;
	}

	private refreshPreview(): void {
		this.previewOwner?.unload();
		this.previewOwner = new Component();
		this.previewOwner.load();
		this.previewEl.empty();
		this.errorEl.empty();
		const config = this.currentConfig();
		if (typeof config === 'string') {
			renderError(this.previewEl, config);
			return;
		}
		renderWidget(this.previewEl, config, this.previewOwner);
	}

	private async submit(): Promise<void> {
		if (this.submitting) return;
		const config = this.currentConfig();
		const error = typeof config === 'string' ? config : validateConfig(config, isValidInstant);
		if (typeof config === 'string' || error) {
			this.errorEl.setText(error ?? '');
			return;
		}
		const json = serializeBlock(this.data, config);

		this.submitting = true;
		let refusal: string | null;
		try {
			refusal =
				this.mode.kind === 'insert'
					? insertBlock(this.app, this.mode.view, this.mode.path, buildBlock(json))
					: await saveEdit(this.app, this.mode.target, json);
		} finally {
			this.submitting = false;
		}

		if (refusal) {
			this.errorEl.setText(refusal);
			new Notice(`Widgetry : ${refusal}`);
			return;
		}
		this.close();
	}
}
