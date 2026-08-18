/**
 * Активная конфигурация рабочей области.
 *
 * Конфигураций в рабочей области может быть несколько: в раскладке EDT конфигурация и
 * расширения лежат соседними проектами, а мультирут добавляет ещё и чужие. Панели, которые
 * работают с одной конфигурацией за раз, спрашивают выбор здесь.
 * @module activeConfiguration
 */

import * as vscode from 'vscode';
import type { SourceRoot } from './projectLayout';

/** Ключ выбора в состоянии рабочей области. */
const STORAGE_KEY = '1c-platform-tools.activeConfiguration';

/** Событие смены активной конфигурации. */
const changed = new vscode.EventEmitter<SourceRoot | undefined>();

/** Подписка на смену активной конфигурации. */
export const onDidChangeActiveConfiguration = changed.event;

/**
 * Активная конфигурация из числа найденных.
 *
 * Сохранённый выбор применяется, пока такая конфигурация есть в рабочей области;
 * иначе берётся первая найденная.
 *
 * @param memento состояние рабочей области
 * @param configurations найденные конфигурации
 */
export function activeConfiguration(
	memento: vscode.Memento | undefined,
	configurations: readonly SourceRoot[]
): SourceRoot | undefined {
	if (configurations.length === 0) {
		return undefined;
	}
	const stored = memento?.get<string>(STORAGE_KEY);
	return configurations.find((configuration) => configuration.dir === stored) ?? configurations[0];
}

/**
 * Запоминает выбор и сообщает о нём подписчикам.
 *
 * @param memento состояние рабочей области
 * @param configuration выбранная конфигурация; undefined снимает выбор
 */
export async function setActiveConfiguration(
	memento: vscode.Memento | undefined,
	configuration: SourceRoot | undefined
): Promise<void> {
	await memento?.update(STORAGE_KEY, configuration?.dir);
	changed.fire(configuration);
}

/** Подпись конфигурации для выбора: имя из метаданных и формат исходников. */
export function describeConfiguration(configuration: SourceRoot): string {
	const format = configuration.format === 'edt' ? 'EDT' : 'конфигуратор';
	return configuration.name.length > 0
		? `${configuration.name} (${format})`
		: `${configuration.dir} (${format})`;
}

/**
 * Показывает выбор конфигурации; undefined — выбор отменён.
 *
 * @param memento состояние рабочей области
 * @param configurations найденные конфигурации
 */
export async function pickActiveConfiguration(
	memento: vscode.Memento | undefined,
	configurations: readonly SourceRoot[]
): Promise<SourceRoot | undefined> {
	if (configurations.length === 0) {
		void vscode.window.showInformationMessage('Исходники конфигурации в рабочей области не найдены.');
		return undefined;
	}

	const current = activeConfiguration(memento, configurations);
	const items = configurations.map((configuration) => ({
		label: describeConfiguration(configuration),
		description: configuration.dir === current?.dir ? 'активная' : undefined,
		configuration,
	}));

	const picked = await vscode.window.showQuickPick(items, {
		title: 'Конфигурация проекта',
		placeHolder: 'С какой конфигурацией работают панели',
	});
	if (!picked) {
		return undefined;
	}

	await setActiveConfiguration(memento, picked.configuration);
	return picked.configuration;
}
