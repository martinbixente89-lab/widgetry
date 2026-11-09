// Affichage des widgets. Chaque minuterie est enregistrée sur le composant propriétaire (`owner`) :
// elle s'arrête quand ce composant est déchargé (widget retiré de la note, formulaire fermé, plugin désactivé).

import { Component } from 'obsidian';
import { quoteIndex, validateConfig, type WidgetConfig } from './format';
import { formatClock, formatRemaining, isValidInstant, parseInstant, remaining } from './time';

export function renderWidget(host: HTMLElement, config: WidgetConfig, owner: Component): void {
	host.empty();
	const root = host.createDiv({
		cls: ['widgetry', `widgetry-size-${config.size}`, `widgetry-align-${config.align}`],
	});

	const error = validateConfig(config, isValidInstant);
	if (error) {
		renderError(root, error);
		return;
	}

	switch (config.type) {
		case 'clock': {
			const value = root.createDiv({ cls: 'widgetry-value' });
			const update = () => value.setText(formatClock(Date.now(), config));
			update();
			owner.registerInterval(window.setInterval(update, 1000));
			break;
		}
		case 'countdown': {
			root.createDiv({ cls: 'widgetry-title', text: config.title });
			const value = root.createDiv({ cls: 'widgetry-value' });
			const status = root.createDiv({ cls: 'widgetry-status' });
			const target = parseInstant(config.target) ?? 0;
			let timer = 0;
			const update = () => {
				const r = remaining(target, Date.now());
				value.setText(formatRemaining(r));
				if (r.done) {
					status.setText('Échéance atteinte');
					window.clearInterval(timer);
				}
			};
			timer = owner.registerInterval(window.setInterval(update, 1000));
			update();
			break;
		}
		case 'quote': {
			const text = root.createDiv({ cls: 'widgetry-quote' });
			let tick = 0;
			const update = () => text.setText(config.quotes[quoteIndex(config, tick)] ?? '');
			update();
			if (config.mode === 'rotate' && config.quotes.length > 1) {
				owner.registerInterval(
					window.setInterval(() => {
						tick++;
						update();
					}, config.interval * 1000),
				);
			}
			break;
		}
	}
}

export function renderError(host: HTMLElement, message: string): void {
	host.createDiv({ cls: 'widgetry-error', text: `Widgetry : ${message}` });
}
