/**
 * Утилиты для работы с файлами версий конфигурации
 * 
 * Предоставляет функции для проверки и обработки файлов версий конфигурации,
 * используемых для инкрементальных операций выгрузки и загрузки.
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';

/** Регулярное выражение для извлечения версии из Configuration.xml (тег Configuration/Properties/Version) */
const CONFIGURATION_VERSION_REGEX = /<Version>([^<]*)<\/Version>/;
/** Регулярное выражение для извлечения имени конфигурации (Configuration/Properties/Name) */
const CONFIGURATION_NAME_REGEX = /<Name>([^<]*)<\/Name>/;
/** Регулярное выражение для извлечения вендора (Configuration/Properties/Vendor) */
const CONFIGURATION_VENDOR_REGEX = /<Vendor>([^<]*)<\/Vendor>/;
/** Регулярное выражение для извлечения режима совместимости (CompatibilityMode), например Version8_3_27 */
const COMPATIBILITY_MODE_REGEX = /<CompatibilityMode>Version(\d+)_(\d+)/;
/** Регулярное выражение для извлечения синонима (ru) конфигурации из первого блока Synonym */
const SYNONYM_RU_REGEX = /<Synonym>[\s\S]*?<v8:lang>ru<\/v8:lang>\s*<v8:content>([^<]*)<\/v8:content>/;

import * as vscode from 'vscode';
import { logger } from '../logger';

/**
 * Читает версию конфигурации из файла Configuration.xml (свойство Configuration/Properties/Version).
 * @param configurationXmlPath - Полный путь к файлу Configuration.xml (обычно src/cf/Configuration.xml)
 * @returns Промис, который разрешается строкой версии или пустой строкой, если не найдена; при ошибке чтения — undefined
 */
export async function readConfigurationVersion(configurationXmlPath: string): Promise<string | undefined> {
	try {
		const content = await fs.readFile(configurationXmlPath, { encoding: 'utf-8' });
		const match = CONFIGURATION_VERSION_REGEX.exec(content);
		return match ? (match[1] ?? '').trim() : '';
	} catch {
		return undefined;
	}
}

/**
 * Свойства конфигурации для подстановки в описание комплекта поставки (1cv8.mft, edf).
 * appVersion формируется из CompatibilityMode (первые две цифры версии, например 8.3).
 * synonymRu — синоним конфигурации (ru) из Configuration/Properties/Synonym.
 */
export interface ConfigurationDeliveryProperties {
	version: string;
	name: string;
	vendor: string;
	appVersion: string;
	synonymRu: string;
}

/**
 * Читает из Configuration.xml свойства для описания комплекта поставки (Version, Name, Vendor, AppVersion, SynonymRu).
 * AppVersion берётся из CompatibilityMode (первые две цифры, например Version8_3_27 → 8.3).
 * @param configurationXmlPath - Полный путь к Configuration.xml
 * @returns Промис с объектом { version, name, vendor, appVersion, synonymRu }; при ошибке чтения — undefined
 */
export async function readConfigurationDeliveryProperties(
	configurationXmlPath: string
): Promise<ConfigurationDeliveryProperties | undefined> {
	try {
		const content = await fs.readFile(configurationXmlPath, { encoding: 'utf-8' });
		const versionMatch = CONFIGURATION_VERSION_REGEX.exec(content);
		const nameMatch = CONFIGURATION_NAME_REGEX.exec(content);
		const vendorMatch = CONFIGURATION_VENDOR_REGEX.exec(content);
		const compatMatch = COMPATIBILITY_MODE_REGEX.exec(content);
		const synonymMatch = SYNONYM_RU_REGEX.exec(content);
		const appVersion =
			compatMatch?.[1] && compatMatch?.[2]
				? `${compatMatch[1]}.${compatMatch[2]}`
				: '8.3';
		const name = (nameMatch?.[1] ?? '').trim() || 'Конфигурация';
		return {
			version: (versionMatch?.[1] ?? '').trim(),
			name,
			vendor: (vendorMatch?.[1] ?? '').trim() || '1C',
			appVersion,
			synonymRu: (synonymMatch?.[1] ?? '').trim() || name
		};
	} catch {
		return undefined;
	}
}

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
