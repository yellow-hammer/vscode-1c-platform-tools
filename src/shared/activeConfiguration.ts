/**
 * Область работы проекта: его конфигурация и всё, что к ней относится.
 *
 * В проекте одна конфигурация, расширения и тестовые расширения проекта принадлежат
 * ей, расширения подпроектов тоже. Вторая и следующие конфигурации без своего
 * `packagedef` не выбираются.
 * @module activeConfiguration
 */

import { resolveProjectLayout, type SourceFormat, type SourceRoot } from './projectLayout';

/** Подписи форматов исходного кода. */
export const SOURCE_FORMAT_LABELS: Record<SourceFormat, string> = {
	designer: '1C:Конфигуратор',
	edt: '1C:EDT',
};

/** Область работы проекта. */
export interface ConfigurationScope {
	/** Конфигурация проекта; её нет, когда исходного кода в проекте нет. */
	configuration?: SourceRoot;
	/** Расширения проекта и его подпроектов: все, что не под каталогом тестов. */
	extensions: SourceRoot[];
	/** Тестовые расширения проекта: под каталогом тестов. */
	testExtensions: SourceRoot[];
	/** Вторая и следующие конфигурации проекта без своего `packagedef`. */
	extraConfigurations: SourceRoot[];
}

/**
 * Конфигурация проекта, его расширения и лишние конфигурации.
 *
 * @param root - Корень проекта
 */
export async function configurationScope(root: string): Promise<ConfigurationScope> {
	const layout = await resolveProjectLayout(root);
	return {
		configuration: layout.configuration,
		extensions: layout.extensions,
		testExtensions: layout.testExtensions,
		extraConfigurations: layout.others,
	};
}
