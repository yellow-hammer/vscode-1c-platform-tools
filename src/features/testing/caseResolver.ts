import { TestFrameworkId } from './frameworkAdapter';
import { DiscoveredCase } from './parsers/parserTypes';
import { caseItemId } from './testItemIds';
import { dedupedCaseId } from './treeLayout';

/**
 * Чистое ядро ленивого резолвера дерева тестов (без зависимостей от vscode)
 *
 * Контроллер при разворачивании/запуске узла-файла читает и парсит его, а затем
 * превращает обнаруженные кейсы в дочерние vscode.TestItem. Вся хрупкая логика
 * (дедупликация ID одноимённых сценариев, сортировка по порядку в файле,
 * проброс тегов) вынесена сюда и покрыта юнит-тестами.
 */

/**
 * Описание дочернего кейса для создания vscode.TestItem
 */
export interface CaseDescriptor {
	/** Уникальный (в пределах файла) ID элемента */
	id: string;
	/** Имя кейса (как в jUnit testcase name) */
	name: string;
	/** Строка объявления, 0-based — для TestItem.range */
	line: number;
	/** Ключ сортировки: кейсы идут по порядку следования в файле, а не по алфавиту */
	sortText: string;
	/** Теги Gherkin без символа @ */
	tags?: string[];
	/** Имя метода-процедуры для точечного запуска, если отличается от name (параметризованные тесты) */
	methodName?: string;
}

/**
 * Строит описания дочерних кейсов файла для ленивого резолвера (resolveHandler)
 *
 * @param adapterId - Идентификатор фреймворка
 * @param uriString - uri.toString() файла
 * @param cases - Кейсы, обнаруженные парсером адаптера
 * @returns Описания кейсов в порядке следования по файлу
 */
export function buildCaseDescriptors(
	adapterId: TestFrameworkId,
	uriString: string,
	cases: DiscoveredCase[]
): CaseDescriptor[] {
	const descriptors: CaseDescriptor[] = [];
	const seenIds = new Set<string>();

	for (const testCase of cases) {
		// Дубли имён (одинаковые сценарии в одном файле) различаем по строке,
		// иначе TestItemCollection отвергнет повторный ID
		const baseId = caseItemId(adapterId, uriString, testCase.name);
		const id = dedupedCaseId(baseId, testCase.line, seenIds);
		descriptors.push({
			id,
			name: testCase.name,
			line: testCase.line,
			sortText: String(testCase.line).padStart(6, '0'),
			tags: testCase.tags,
			methodName: testCase.methodName
		});
	}

	return descriptors;
}
