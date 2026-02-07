import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { BaseCommand } from './baseCommand';
import {
	getUpdateCfgSupportCommandName,
	getDisableCfgSupportCommandName,
	getCreateDeliveryDescriptionFileCommandName,
	getCreateTemplateListFileCommandName,
	getCreateDistributivePackageCommandName,
	getCreateDistributionFilesCommandName
} from '../commandNames';
import { readConfigurationVersion, readConfigurationDeliveryProperties } from '../utils/configVersionUtils';
import { logger } from '../logger';

/** Имя файла поставки (канонический регистр для путей в команде) */
const DISTRIBUTION_CF_FILENAME = '1Cv8.cf';
/** Символы, недопустимые в пути к каталогу версии (Windows/Unix). Заменяются на подчёркивание. */
const INVALID_VERSION_PATH_CHARS = /[\\/:*?"<>|]/g;
/** Регулярное выражение для извлечения Описание.Имя("...") из packagedef */
const PACKAGEDEF_OPISANIE_IMYA_REGEX = /Описание\.Имя\s*\(\s*["']([^"']+)["']\s*\)/;

/** Префикс для детерминированной генерации GUID элементов описания поставки (UUID v5-подобный из SHA-1). */
const DELIVERY_EDF_NAMESPACE = '1c-platform-tools:delivery-edf:';

/**
 * Генерирует детерминированный GUID для элемента описания поставки по его имени.
 * Один и тот же name всегда даёт один и тот же UUID (SHA-1 от namespace+name, оформленный как UUID).
 * @param name - Имя элемента (например, "Файл конфигурации")
 * @returns Строка UUID в нижнем регистре
 */
function generateDeliveryItemGuid(name: string): string {
	const hash = crypto.createHash('sha1').update(DELIVERY_EDF_NAMESPACE + name, 'utf8').digest();
	const buf = Buffer.alloc(16);
	hash.copy(buf, 0, 0, 16);
	buf[6] = (buf[6] & 0x0f) | 0x50;
	buf[8] = (buf[8] & 0x3f) | 0x80;
	const hex = buf.toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Опция для команды UpdateCfg */
const UPDATECFG_OPTIONS = [
	{ id: 'IncludeObjectsByUnresolvedRefs', label: '-IncludeObjectsByUnresolvedRefs', description: 'Помечать для объединения объекты по неразрешённым ссылкам' },
	{ id: 'ClearUnresolvedRefs', label: '-ClearUnresolvedRefs', description: 'Очищать ссылки на не включённые объекты' },
	{ id: 'DumpListOfTwiceChangedProperties', label: '-DumpListOfTwiceChangedProperties', description: 'Вывести список дважды изменённых свойств в файл сообщений' },
	{ id: 'force', label: '-force', description: 'Проводить объединение при предупреждениях (по умолчанию)' }
] as const;

/**
 * Команды группы «Поддержка»: обновление и снятие с поддержки конфигурации.
 * Выполняются через vrunner designer --additional.
 */
export class SupportCommands extends BaseCommand {

	/**
	 * Обновление конфигурации, находящейся на поддержке (UpdateCfg).
	 * Предлагает выбрать cf/cfu и файл настроек из каталога шаблонов (paths.dist),
	 * затем окно выбора опций объединения.
	 */
	async updateCfg(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const distPath = this.vrunner.getDistPath();
		const distFullPath = path.join(workspaceRoot, distPath);
		if (!(await this.ensureDirectoryExists(distFullPath, `Ошибка при создании каталога шаблонов ${distPath}`))) {
			return;
		}

		const cfCfuUri = await vscode.window.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			openLabel: 'Выбрать cf или cfu',
			filters: { 'Конфигурация': ['cf', 'cfu'] },
			defaultUri: vscode.Uri.file(distFullPath)
		});

		if (!cfCfuUri || cfCfuUri.length === 0) {
			return;
		}

		const settingsUri = await vscode.window.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			openLabel: 'Выбрать файл настроек объединения',
			filters: { 'XML и все': ['xml', '*'] },
			defaultUri: vscode.Uri.file(distFullPath)
		});

		if (!settingsUri || settingsUri.length === 0) {
			return;
		}

		const selectedOptions = await vscode.window.showQuickPick(UPDATECFG_OPTIONS, {
			canPickMany: true,
			placeHolder: 'Выберите опции объединения (необязательно)',
			matchOnDescription: true
		});

		if (selectedOptions === undefined) {
			return;
		}

		const cfCfuRelative = path.relative(workspaceRoot, cfCfuUri[0].fsPath);
		const settingsRelative = path.relative(workspaceRoot, settingsUri[0].fsPath);
		const optionsStr = selectedOptions.map((o) => o.label).join(' ');
		const optionsPart = optionsStr.length > 0 ? ' ' + optionsStr : '';
		const additionalParam = ' /UpdateCfg "' + cfCfuRelative + '" -Settings "' + settingsRelative + '"' + optionsPart;

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = ['designer', '--additional', additionalParam, ...ibConnectionParam];
		const commandName = getUpdateCfgSupportCommandName();

		this.vrunner.executeVRunnerInTerminal(args, {
			cwd: workspaceRoot,
			name: commandName.title
		});
	}

	/**
	 * Снять конфигурацию с поддержки (ManageCfgSupport -disableSupport -force).
	 * Всегда выполняется с -force, без запроса.
	 */
	async disableCfgSupport(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const additionalParam = ' /ManageCfgSupport -disableSupport -force';
		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = ['designer', '--additional', additionalParam, ...ibConnectionParam];
		const commandName = getDisableCfgSupportCommandName();

		this.vrunner.executeVRunnerInTerminal(args, { cwd: workspaceRoot, name: commandName.title });
	}

	/**
	 * Создать файл списка шаблонов конфигураций (/CreateTemplateListFile).
	 * Предлагает сохранить файл (по умолчанию в paths.dist) и опционально указать каталог поиска шаблонов.
	 */
	async createTemplateListFile(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const distPath = this.vrunner.getDistPath();
		const distFullPath = path.join(workspaceRoot, distPath);
		if (!(await this.ensureDirectoryExists(distFullPath, `Ошибка при создании каталога шаблонов ${distPath}`))) {
			return;
		}

		const defaultUri = vscode.Uri.file(path.join(distFullPath, 'templates.xml'));
		const fileUri = await vscode.window.showSaveDialog({
			defaultUri,
			saveLabel: 'Сохранить файл списка шаблонов',
			filters: { 'XML': ['xml'], 'Все': ['*'] }
		});
		if (!fileUri) {
			return;
		}

		const fileRelative = path.relative(workspaceRoot, fileUri.fsPath);
		let additionalParam = ' /CreateTemplateListFile "' + fileRelative + '"';
		const useCustomSource = await vscode.window.showQuickPick(
			[
				{ label: 'Использовать каталог по умолчанию', sourcePath: '' },
				{ label: 'Указать каталог поиска шаблонов', sourcePath: 'custom' }
			],
			{ placeHolder: 'Каталог для поиска файлов шаблонов' }
		);
		if (useCustomSource === undefined) {
			return;
		}
		if (useCustomSource.sourcePath === 'custom') {
			const folderUris = await vscode.window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: 'Выбрать каталог шаблонов',
				defaultUri: vscode.Uri.file(distFullPath)
			});
			if (!folderUris || folderUris.length === 0) {
				return;
			}
			const sourceRelative = path.relative(workspaceRoot, folderUris[0].fsPath);
			additionalParam += ' -TemplatesSourcePath "' + sourceRelative + '"';
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = ['designer', '--additional', additionalParam, ...ibConnectionParam];
		const commandName = getCreateTemplateListFileCommandName();
		this.vrunner.executeVRunnerInTerminal(args, { cwd: workspaceRoot, name: commandName.title });
	}

	/**
	 * Создать файл описания комплекта поставки (edf) по шаблону, заполняя его из Configuration.xml.
	 * Версия и каталог: build/dist/&lt;версия&gt;/; имя файла по умолчанию: Комплект.edf.
	 */
	async createDeliveryDescriptionFile(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const extensionPath = this.vrunner.getExtensionPath();
		if (!extensionPath) {
			vscode.window.showErrorMessage('Не доступен путь к расширению (extensionPath).');
			return;
		}

		const cfPath = this.vrunner.getCfPath();
		const configurationXmlPath = path.join(workspaceRoot, cfPath, 'Configuration.xml');
		const props = await readConfigurationDeliveryProperties(configurationXmlPath);
		if (!props) {
			void vscode.window.showErrorMessage(`Не удалось прочитать свойства из ${path.join(cfPath, 'Configuration.xml')}.`);
			return;
		}

		const suggestedVersion = props.version?.trim() || '1.0.0';
		const version = await vscode.window.showInputBox({
			prompt: 'Версия (каталог build/dist/<версия>, из Configuration.xml или введите вручную)',
			value: suggestedVersion,
			placeHolder: '1.0.0.1'
		});
		if (!version?.trim()) {
			return;
		}
		const versionTrimmed = version.trim().replaceAll(INVALID_VERSION_PATH_CHARS, '_');

		const distPath = this.vrunner.getDistPath();
		const versionDir = path.join(distPath, versionTrimmed);
		const versionDirFull = path.join(workspaceRoot, versionDir);
		if (!(await this.ensureDirectoryExists(versionDirFull, `Ошибка при создании каталога ${versionDir}`))) {
			return;
		}

		const templatePath = path.join(extensionPath, 'resources', 'templates', 'delivery.edf.template');
		let templateContent: string;
		try {
			templateContent = await fs.readFile(templatePath, { encoding: 'utf-8' });
		} catch {
			vscode.window.showErrorMessage(`Шаблон не найден: ${templatePath}`);
			return;
		}

		const vendorEscaped = (props.vendor ?? '1C').replaceAll('"', '""');
		const nameRuEscaped = (props.synonymRu ?? props.name ?? 'Конфигурация').replaceAll('"', '""');
		const nameInternal = props.name?.trim() || 'Конфигурация';
		const versionValue = props.version?.trim() || versionTrimmed;
		const guidConfigFile = generateDeliveryItemGuid('Файл конфигурации');
		const guidDumpFile = generateDeliveryItemGuid('Файл выгрузки информационной базы');

		const content = templateContent
			.replaceAll('%Vendor%', vendorEscaped)
			.replaceAll('%NameRu%', nameRuEscaped)
			.replaceAll('%NameInternal%', nameInternal)
			.replaceAll('%Version%', versionValue)
			.replaceAll('%GuidConfigFile%', guidConfigFile)
			.replaceAll('%GuidDumpFile%', guidDumpFile);

		const edfFileName = 'Комплект.edf';
		const edfPath = path.join(versionDirFull, edfFileName);
		await fs.writeFile(edfPath, content, { encoding: 'utf-8' });

		const commandName = getCreateDeliveryDescriptionFileCommandName();
		void vscode.window.showInformationMessage(
			`${commandName.title}: создан файл ${path.join(versionDir, edfFileName)}`
		);
		logger.info(`Создан файл описания поставки: ${edfPath}`);
	}

	/**
	 * Создать комплект поставки по описанию (/CreateDistributivePackage).
	 * Сначала выбор режима (MakeSetup/MakeFiles), затем версия из Configuration.xml и выбор файла .edf в build/dist/&lt;версия&gt;.
	 */
	async createDistributivePackage(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const modeChoice = await vscode.window.showQuickPick(
			[
				{ label: '-MakeFiles', description: 'Создать файлы комплекта поставки', param: '-MakeFiles' },
				{ label: '-MakeSetup', description: 'Создать комплект поставки (архив)', param: '-MakeSetup' }
			],
			{
				title: 'Режим создания',
				placeHolder: 'Выберите режим'
			}
		);
		if (!modeChoice) {
			return;
		}

		const cfPath = this.vrunner.getCfPath();
		const configurationXmlPath = path.join(workspaceRoot, cfPath, 'Configuration.xml');
		const versionFromSource = await readConfigurationVersion(configurationXmlPath);
		const suggestedVersion = (versionFromSource?.trim() && versionFromSource) || '1.0.0';

		const version = await vscode.window.showInputBox({
			prompt: 'Версия (каталог для выбора файла описания)',
			value: suggestedVersion,
			placeHolder: '1.0.0.1'
		});
		if (!version?.trim()) {
			return;
		}
		const versionTrimmed = version.trim().replaceAll(INVALID_VERSION_PATH_CHARS, '_');

		const distPath = this.vrunner.getDistPath();
		const versionDirFull = path.join(workspaceRoot, distPath, versionTrimmed);
		const distFullPath = path.join(workspaceRoot, distPath);
		if (!(await this.ensureDirectoryExists(distFullPath, `Каталог поставки не найден: ${distPath}`))) {
			return;
		}

		const selected = await vscode.window.showOpenDialog({
			title: 'Выберите файл описания поставки (edf)',
			defaultUri: vscode.Uri.file(versionDirFull),
			canSelectMany: false,
			filters: { 'Описание поставки (edf)': ['edf'] }
		});
		if (!selected?.length) {
			return;
		}
		const edfPathFs = selected[0].fsPath;
		const relativePath = path.relative(workspaceRoot, edfPathFs);
		if (relativePath.startsWith('..')) {
			void vscode.window.showWarningMessage('Выбран файл вне рабочего каталога. Укажите файл из build/dist.');
			return;
		}
		const fileRelative = relativePath.replaceAll(path.sep, '/');
		const outDirRelative = path.dirname(fileRelative).replaceAll(path.sep, '/');

		const baseParam = ' /CreateDistributivePackage "' + outDirRelative + '" -File "' + fileRelative + '"';
		let additionalParam: string;
		if (modeChoice.param === '-MakeFiles') {
			additionalParam = baseParam + ' -MakeFiles';
		} else {
			const packageFileName = await this.buildDistributivePackageFileName(workspaceRoot, version.trim());
			additionalParam = baseParam + ' -PackageFileName "' + packageFileName + '" -MakeSetup';
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = ['designer', '--additional', additionalParam, ...ibConnectionParam];
		const commandName = getCreateDistributivePackageCommandName();
		this.vrunner.executeVRunnerInTerminal(args, { cwd: workspaceRoot, name: commandName.title });
	}

	/**
	 * Создать файлы поставки и обновления (/CreateDistributionFiles).
	 * Варианты: cf, cf+cfu, cfu. Версия из Configuration.xml; результат в build/dist/&lt;версия&gt;/ (1Cv8.cf и/или 1Cv8.cfu).
	 * Для cf+cfu и cfu предыдущие версии с 1Cv8.cf подставляются в -f автоматически.
	 */
	async createDistributionFiles(): Promise<void> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return;
		}

		const cfPath = this.vrunner.getCfPath();
		const configurationXmlPath = path.join(workspaceRoot, cfPath, 'Configuration.xml');
		let versionFromSource: string | undefined;
		try {
			versionFromSource = await readConfigurationVersion(configurationXmlPath);
		} catch {
			versionFromSource = undefined;
		}
		const suggestedVersion = (versionFromSource?.trim() && versionFromSource) || '1.0.0';

		const version = await vscode.window.showInputBox({
			prompt: 'Версия поставки (из Configuration.xml или введите вручную)',
			value: suggestedVersion,
			placeHolder: '1.0.0.1'
		});
		if (!version?.trim()) {
			return;
		}
		const versionTrimmed = version.trim().replaceAll(INVALID_VERSION_PATH_CHARS, '_');

		const distPath = this.vrunner.getDistPath();
		const versionDir = path.join(distPath, versionTrimmed);
		const versionDirFull = path.join(workspaceRoot, versionDir);
		if (!(await this.ensureDirectoryExists(versionDirFull, `Ошибка при создании каталога ${versionDir}`))) {
			return;
		}

		const modeChoice = await vscode.window.showQuickPick(
			[
				{ label: 'Только файл поставки (cf)', mode: 'cf' as const },
				{ label: 'Файл поставки и обновления (cf + cfu)', mode: 'cf+cfu' as const },
				{ label: 'Только обновление (cfu)', mode: 'cfu' as const }
			],
			{ placeHolder: 'Что создавать' }
		);
		if (modeChoice === undefined) {
			return;
		}

		const distFull = path.join(workspaceRoot, distPath);
		const previousVersions = await this.getPreviousVersionCfPaths(workspaceRoot, distFull, distPath, versionTrimmed);
		const cfuRelative = path.join(versionDir, '1Cv8.cfu');
		const cfRelative = path.join(versionDir, DISTRIBUTION_CF_FILENAME);
		const { additionalParam, noPreviousVersionsWarning, requirePreviousVersions } = this.buildCreateDistributionFilesParam(
			modeChoice.mode,
			cfRelative,
			cfuRelative,
			previousVersions
		);
		if (requirePreviousVersions && previousVersions.length === 0) {
			void vscode.window.showErrorMessage(
				noPreviousVersionsWarning ?? 'Для создания cfu нужны предыдущие версии с файлом 1Cv8.cf в build/dist.'
			);
			return;
		}
		if (noPreviousVersionsWarning) {
			logger.info(noPreviousVersionsWarning);
			void vscode.window.showInformationMessage(noPreviousVersionsWarning);
		}

		const ibConnectionParam = await this.vrunner.getIbConnectionParam();
		const args = ['designer', '--additional', additionalParam, ...ibConnectionParam];
		const commandName = getCreateDistributionFilesCommandName();
		this.vrunner.executeVRunnerInTerminal(args, { cwd: workspaceRoot, name: commandName.title });
	}

	/**
	 * Формирует параметр --additional для /CreateDistributionFiles по выбранному режиму (cf, cf+cfu, cfu).
	 * Для режима cfu предыдущие версии обязательны (requirePreviousVersions); при их отсутствии выполнение блокируется.
	 */
	private buildCreateDistributionFilesParam(
		mode: 'cf' | 'cf+cfu' | 'cfu',
		cfRelative: string,
		cfuRelative: string,
		previousVersions: string[]
	): { additionalParam: string; noPreviousVersionsWarning?: string; requirePreviousVersions?: boolean } {
		if (mode === 'cf') {
			return { additionalParam: ' /CreateDistributionFiles -cffile "' + cfRelative + '"' };
		}
		if (mode === 'cf+cfu') {
			let param = ' /CreateDistributionFiles -cffile "' + cfRelative + '"';
			if (previousVersions.length === 0) {
				return { additionalParam: param, noPreviousVersionsWarning: 'В build/dist нет предыдущих версий с файлом 1Cv8.cf; создаётся только cf.' };
			}
			param += ' -cfufile "' + cfuRelative + '"';
			for (const rel of previousVersions) {
				param += ' -f "' + rel + '"';
			}
			return { additionalParam: param };
		}
		const cfuNoBaseMsg =
			'Для создания только cfu нужны предыдущие версии с файлом 1Cv8.cf в build/dist. Добавьте каталоги версий с полной поставкой (1Cv8.cf).';
		if (previousVersions.length === 0) {
			return {
				additionalParam: ' /CreateDistributionFiles -cfufile "' + cfuRelative + '"',
				noPreviousVersionsWarning: cfuNoBaseMsg,
				requirePreviousVersions: true
			};
		}
		let param = ' /CreateDistributionFiles -cfufile "' + cfuRelative + '"';
		for (const rel of previousVersions) {
			param += ' -f "' + rel + '"';
		}
		return { additionalParam: param };
	}

	/**
	 * Формирует имя архива комплекта поставки: &lt;Описание.Имя из packagedef&gt;_&lt;версия через _&gt;_setup1c.zip
	 * @param workspaceRoot - Корень workspace
	 * @param version - Версия (точки заменяются на нижнее подчёркивание)
	 * @returns Имя файла, например HRM_3_1_36_75_setup1c.zip
	 */
	private async buildDistributivePackageFileName(workspaceRoot: string, version: string): Promise<string> {
		let namePart = 'setup';
		try {
			const content = await fs.readFile(path.join(workspaceRoot, 'packagedef'), 'utf-8');
			const match = PACKAGEDEF_OPISANIE_IMYA_REGEX.exec(content);
			if (match?.[1]?.trim()) {
				namePart = match[1].trim().replaceAll(INVALID_VERSION_PATH_CHARS, '_').replaceAll('.', '_');
			}
		} catch {
			// оставляем namePart по умолчанию
		}
		const versionPart = version.replaceAll(INVALID_VERSION_PATH_CHARS, '_').replaceAll('.', '_');
		return `${namePart}_${versionPart}_setup1c.zip`;
	}

	/**
	 * Возвращает относительные пути к 1Cv8.cf в подкаталогах build/dist, кроме текущей версии (для -f при создании cfu).
	 * Поиск файла поставки — регистронезависимый; в результате всегда используется каноническое имя 1Cv8.cf.
	 * Подкаталоги сортируются по имени (версии), чтобы старые версии шли первыми.
	 */
	private async getPreviousVersionCfPaths(
		workspaceRoot: string,
		distFull: string,
		distPath: string,
		currentVersion: string
	): Promise<string[]> {
		try {
			const entries = await fs.readdir(distFull, { withFileTypes: true });
			const subdirs = entries
				.filter(e => e.isDirectory() && e.name !== currentVersion)
				.map(e => e.name)
				.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

			const result: string[] = [];
			for (const subdir of subdirs) {
				const subdirFull = path.join(distFull, subdir);
				const hasCf = await this.subdirContainsCfFile(subdirFull);
				if (hasCf) {
					result.push(path.join(distPath, subdir, DISTRIBUTION_CF_FILENAME));
				}
			}
			return result;
		} catch {
			return [];
		}
	}

	/**
	 * Проверяет наличие файла поставки (1Cv8.cf) в каталоге по регистронезависимому имени.
	 */
	private async subdirContainsCfFile(subdirFull: string): Promise<boolean> {
		try {
			const files = await fs.readdir(subdirFull, { withFileTypes: true });
			return files.some(
				f => f.isFile() && f.name.toLowerCase() === DISTRIBUTION_CF_FILENAME.toLowerCase()
			);
		} catch {
			return false;
		}
	}
}
