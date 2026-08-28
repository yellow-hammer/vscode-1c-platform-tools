/**
 * Реестр внешних компонентов расширения.
 *
 * Компоненты загружаются из релизов GitHub в кэш расширения. `ensure*` уважают
 * настройку своего пути и выключенную автозагрузку, `download` их игнорирует.
 *
 * @module componentsRegistry
 */

import * as vscode from 'vscode';
import {
	cachedOnecDebugAdapterPath,
	cachedOnecDebugAdapterTag,
	clearOnecDebugAdapterCache,
	downloadOnecDebugAdapter,
} from '../features/debug/onecDebugAdapterBootstrap';
import {
	cachedMdSparrowPath,
	cachedMdSparrowTag,
	clearMdSparrowJarCache,
	clearPortableJreCache,
	downloadMdSparrowJar,
	downloadPortableJre,
	portableJreJavaPath,
	portableJreVersion,
} from '../features/metadata/mdSparrowBootstrap';
import { cachedOvmPath, cachedOvmTag, clearOvmCache, downloadOvm } from './ovmComponent';
import { cachedAllurePath, cachedAllureTag, clearAllureCache, downloadAllure } from './allureComponent';

/** Описание одного загружаемого компонента. */
export interface ComponentSpec {
	/** Идентификатор для журнала и тестов. */
	id: 'adapter' | 'metadataTree' | 'jre' | 'ovm' | 'allure';
	/** Название в списке выбора: что это и для чего. */
	title: string;
	/** Настройка своего пути: с ней обычная работа идёт мимо загрузки. */
	pathSetting: string;
	/** Настройка автозагрузки. */
	autoloadSetting: string;
	/** Загруженная версия или undefined. */
	version: (context: vscode.ExtensionContext) => Promise<string | undefined>;
	/** Забывает загруженное. */
	clear: (context: vscode.ExtensionContext) => Promise<void>;
	/** Загружает заново, не глядя на настройки пути и автозагрузки. */
	download: (context: vscode.ExtensionContext) => Promise<unknown>;
	/** Путь загруженного артефакта в кэше, без повторной загрузки. */
	cachePath: (context: vscode.ExtensionContext) => Promise<string | undefined>;
}

/**
 * Все загружаемые компоненты в порядке показа.
 *
 * Portable JRE идёт перед деревом метаданных: дерево запускается ею.
 */
export const COMPONENTS: ComponentSpec[] = [
	{
		id: 'adapter',
		title: 'Отладчик 1С (onec-debug-adapter)',
		pathSetting: 'components.adapterFile',
		autoloadSetting: 'components.adapterAutoload',
		version: cachedOnecDebugAdapterTag,
		clear: clearOnecDebugAdapterCache,
		download: downloadOnecDebugAdapter,
		cachePath: cachedOnecDebugAdapterPath,
	},
	{
		id: 'jre',
		title: 'Portable JRE 21 (нужна дереву метаданных)',
		pathSetting: 'components.javaExecutable',
		autoloadSetting: 'components.jreAutoload',
		version: async (context) => portableJreVersion(context),
		clear: clearPortableJreCache,
		download: downloadPortableJre,
		cachePath: async (context) => portableJreJavaPath(context),
	},
	{
		id: 'metadataTree',
		title: 'Дерево метаданных (md-sparrow)',
		pathSetting: 'components.metadataJarFile',
		autoloadSetting: 'components.metadataJarAutoload',
		version: cachedMdSparrowTag,
		clear: clearMdSparrowJarCache,
		download: downloadMdSparrowJar,
		cachePath: cachedMdSparrowPath,
	},
	{
		id: 'ovm',
		title: 'OVM (менеджер версий OneScript)',
		pathSetting: 'components.ovmFile',
		autoloadSetting: 'components.ovmAutoload',
		version: cachedOvmTag,
		clear: clearOvmCache,
		download: downloadOvm,
		cachePath: cachedOvmPath,
	},
	{
		id: 'allure',
		title: 'Allure (отчёты о прогонах тестов)',
		pathSetting: 'allure.path',
		autoloadSetting: 'components.allureAutoload',
		version: cachedAllureTag,
		clear: clearAllureCache,
		download: downloadAllure,
		cachePath: cachedAllurePath,
	},
];

/** Состояние компонента для списка выбора. */
export interface ComponentState {
	spec: ComponentSpec;
	/** Загруженная версия или undefined. */
	version: string | undefined;
	/** Задан свой путь: обычная работа идёт мимо загруженного. */
	overridden: boolean;
	/** Автозагрузка выключена. */
	autoloadOff: boolean;
}

/**
 * Собирает состояние всех компонентов.
 *
 * @param context - Контекст расширения
 * @returns Состояния в порядке {@link COMPONENTS}
 */
export async function readComponentStates(context: vscode.ExtensionContext): Promise<ComponentState[]> {
	const config = vscode.workspace.getConfiguration('1c-platform-tools');
	return Promise.all(
		COMPONENTS.map(async (spec) => ({
			spec,
			version: await spec.version(context).catch(() => undefined),
			overridden: config.get<string>(spec.pathSetting, '').trim() !== '',
			autoloadOff: config.get<boolean>(spec.autoloadSetting, true) === false,
		}))
	);
}

/**
 * Строит подпись состояния для списка выбора.
 *
 * @param state - Состояние компонента
 * @returns Короткое описание: версия и особые настройки
 */
export function describeComponentState(state: ComponentState): string {
	const parts = [state.version ?? 'не загружен'];
	if (state.overridden) {
		parts.push(`свой путь: ${state.spec.pathSetting}`);
	}
	if (state.autoloadOff) {
		parts.push('автозагрузка выключена');
	}
	return parts.join(' · ');
}
