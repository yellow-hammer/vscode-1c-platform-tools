/**
 * Виды бинарных файлов 1С: подпись, значок из дерева метаданных и команда разбора.
 * @module artifactKinds
 */

import * as path from 'node:path';

/** Бинарный файл 1С, который расширение умеет разобрать. */
export interface BinaryArtifactKind {
	/** Подпись вида файла */
	label: string;
	/** Значок из resources/metadata-tree-icons */
	icon?: string;
	/** Команда разбора; принимает элемент с resourceUri */
	decompileCommand?: string;
	/** Пакет OneScript ставится, а не разбирается */
	install?: boolean;
}

const KINDS: Record<string, BinaryArtifactKind> = {
	'.cf': {
		label: 'Конфигурация',
		icon: 'configuration.svg',
		decompileCommand: '1c-platform-tools.artifacts.decompileConfiguration',
	},
	'.cfe': {
		label: 'Расширение конфигурации',
		icon: 'extension.svg',
		decompileCommand: '1c-platform-tools.artifacts.decompileExtension',
	},
	'.epf': {
		label: 'Внешняя обработка',
		icon: 'dataProcessor.svg',
		decompileCommand: '1c-platform-tools.artifacts.decompileProcessor',
	},
	'.erf': {
		label: 'Внешний отчёт',
		icon: 'report.svg',
		decompileCommand: '1c-platform-tools.artifacts.decompileReport',
	},
	'.ospx': {
		label: 'Пакет',
		icon: 'package.svg',
		install: true,
	},
};

/**
 * Вид бинарного файла 1С по расширению имени.
 *
 * @param filePath - Путь к файлу
 * @returns Вид файла или undefined, если это не файл 1С
 */
export function binaryArtifactKind(filePath: string): BinaryArtifactKind | undefined {
	return KINDS[path.extname(filePath).toLowerCase()];
}
