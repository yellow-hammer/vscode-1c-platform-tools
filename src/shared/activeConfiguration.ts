/**
 * Активная конфигурация: с чем работают команды и панели.
 *
 * В рабочей области бывает несколько конфигураций: в формате EDT конфигурация и
 * её расширения лежат соседними проектами, мультирут добавляет ещё. Выбор одной
 * задаёт область работы всего расширения, чтобы панели не решали это каждая
 * по-своему.
 *
 * Выбор хранится в `workspaceState`: он локальный, как и выбор профиля запуска.
 * @module activeConfiguration
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { resolveProjectLayout, type SourceRoot } from './projectLayout';

/** Ключ выбранной конфигурации в workspaceState. */
const ACTIVE_CONFIGURATION_KEY = 'activeConfigurationDir';

let memento: vscode.Memento | undefined;

const changed = new vscode.EventEmitter<void>();

/** Срабатывает при выборе другой конфигурации. */
export const onDidChangeActiveConfiguration = changed.event;

/**
 * Область работы: конфигурация и относящиеся к ней расширения.
 */
export interface ConfigurationScope {
	/** Выбранная конфигурация; её нет, когда исходного кода в рабочей области нет. */
	configuration?: SourceRoot;
	/** Расширения выбранной конфигурации: поставляемые. */
	extensions: SourceRoot[];
	/** Тестовые расширения выбранной конфигурации: под каталогом tests. */
	testExtensions: SourceRoot[];
	/** Остальные конфигурации рабочей области - между ними и переключаются. */
	others: SourceRoot[];
}

/**
 * Запоминает хранилище выбора.
 *
 * @param context - Контекст расширения
 */
export function initActiveConfiguration(context: vscode.ExtensionContext): void {
	memento = context.workspaceState;
}

/**
 * Сохраняет выбор конфигурации.
 *
 * @param directory - Каталог конфигурации; без него выбор снимается
 */
export async function setActiveConfiguration(directory: string | undefined): Promise<void> {
	await memento?.update(ACTIVE_CONFIGURATION_KEY, directory ? path.resolve(directory) : undefined);
	changed.fire();
}

/**
 * Относится ли расширение к конфигурации.
 *
 * В формате EDT проект расширения принято называть по конфигурации:
 * `ssl31._ДемоРасширение` рядом с `ssl31`. В формате конфигуратора расширения
 * лежат отдельным каталогом и такого признака не имеют.
 */
function belongsTo(extension: SourceRoot, configuration: SourceRoot): boolean {
	if (extension.format !== configuration.format) {
		return false;
	}
	if (configuration.format !== 'edt') {
		return true;
	}
	return path.basename(extension.dir).startsWith(`${path.basename(configuration.dir)}.`);
}

/**
 * Конфигурация, с которой сейчас работают, и её расширения.
 *
 * Выбор из `workspaceState` действует, пока такая конфигурация есть в рабочей
 * области; иначе берётся первая найденная.
 *
 * @param workspaceRoot - Корень рабочей области
 */
export async function configurationScope(workspaceRoot: string): Promise<ConfigurationScope> {
	const layout = await resolveProjectLayout(workspaceRoot);
	const all = [...(layout.configuration ? [layout.configuration] : []), ...layout.others];

	const selected = memento?.get<string>(ACTIVE_CONFIGURATION_KEY);
	const configuration = all.find((root) => root.dir === selected) ?? all[0];
	if (!configuration) {
		return {
			configuration: undefined,
			extensions: layout.extensions,
			testExtensions: layout.testExtensions,
			others: [],
		};
	}

	// Пока конфигурация одна, все найденные расширения относятся к ней: имя
	// каталога у расширения может не совпадать с именем конфигурации.
	// Расширение, не подошедшее ни к одной конфигурации, считаем общим:
	// потерять его хуже, чем показать лишнее.
	const own = (extensions: SourceRoot[]): SourceRoot[] =>
		all.length > 1
			? extensions.filter(
				(extension) =>
					belongsTo(extension, configuration) ||
					!all.some((candidate) => belongsTo(extension, candidate))
			)
			: extensions;

	return {
		configuration,
		extensions: own(layout.extensions),
		testExtensions: own(layout.testExtensions),
		others: all.filter((root) => root.dir !== configuration.dir),
	};
}
