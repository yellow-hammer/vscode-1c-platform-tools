/**
 * Утилиты для работы с файлами версий конфигурации
 * 
 * Предоставляет функции для проверки и обработки файлов версий конфигурации,
 * используемых для инкрементальных операций выгрузки и загрузки.
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { logger } from '../logger';

/**
 * Проверяет существование файла версии ConfigDumpInfo.xml
 * @param configDumpInfoPath - Полный путь к файлу ConfigDumpInfo.xml
 * @returns Промис, который разрешается true, если файл существует, иначе false
 */
export async function checkVersionFileExists(configDumpInfoPath: string): Promise<boolean> {
	try {
		await fs.access(configDumpInfoPath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Обрабатывает ситуацию, когда файл версии отсутствует
 * Если каталог не пуст, предлагает пользователю очистить его или отменить операцию
 * @param srcFullPath - Полный путь к каталогу исходников
 * @param srcPath - Относительный путь к каталогу исходников
 * @returns Промис, который разрешается true, если операция может быть продолжена, иначе false
 */
export async function handleMissingVersionFile(srcFullPath: string, srcPath: string): Promise<boolean> {
	try {
		const entries = await fs.readdir(srcFullPath);
		const hasFiles = entries.some(entry => entry !== 'ConfigDumpInfo.xml');
		
		if (!hasFiles) {
			return true;
		}

		logger.info(`Файл ConfigDumpInfo.xml не найден в каталоге ${srcPath}, запрос пользователя`);
		const action = await vscode.window.showWarningMessage(
			`Файл ConfigDumpInfo.xml не найден в каталоге ${srcPath}. Для инкрементальной выгрузки необходим файл версии. Выполните сначала полную выгрузку через "Выгрузить конфигурацию в src/cf".`,
			'Выполнить полную выгрузку (очистить каталог)',
			'Отмена'
		);

		if (action === 'Отмена' || action === undefined) {
			logger.debug('Пользователь отменил операцию (ConfigDumpInfo.xml отсутствует)');
			return false;
		}

		if (action === 'Выполнить полную выгрузку (очистить каталог)') {
			logger.info(`Очистка каталога ${srcFullPath} перед полной выгрузкой`);
			await clearDirectory(srcFullPath, entries);
			return true;
		}

		return false;
	} catch {
		return true;
	}
}

/**
 * Очищает каталог от всех файлов и подкаталогов
 * @param dirPath - Путь к каталогу
 * @param entries - Список записей в каталоге
 */
export async function clearDirectory(dirPath: string, entries: string[]): Promise<void> {
	for (const entry of entries) {
		const entryPath = path.join(dirPath, entry);
		const stat = await fs.stat(entryPath);
		if (stat.isDirectory()) {
			await fs.rm(entryPath, { recursive: true, force: true });
		} else {
			await fs.unlink(entryPath);
		}
	}
}
