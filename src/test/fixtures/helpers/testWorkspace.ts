import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';

export interface TestWorkspaceOptions {
	template?: 'minimal-1c-project' | 'full-1c-project' | 'empty-project';
	customFiles?: Record<string, string>; // Путь относительно workspace -> содержимое
	modifyFiles?: Record<string, (content: string) => string>; // Модификация существующих файлов
}

/**
 * Получить путь к директории с шаблонами фикстур
 * Работает как в исходниках, так и в скомпилированном коде
 */
function getFixturesPath(): string {
	// __dirname в скомпилированном коде: out/test/fixtures/helpers
	// __dirname в исходниках: src/test/fixtures/helpers (если запускается напрямую)
	
	// Если это скомпилированный код, нужно подняться к исходникам
	// out/test/fixtures/helpers -> корень проекта -> src/test/fixtures/workspace-templates
	if (__dirname.includes(path.join('out', 'test')) || __dirname.includes(String.raw`out\test`)) {
		// Поднимаемся от out/test/fixtures/helpers к корню проекта (4 уровня вверх)
		const projectRoot = path.resolve(__dirname, '../../../..');
		return path.join(projectRoot, 'src', 'test', 'fixtures', 'workspace-templates');
	}
	
	// Иначе используем относительный путь (для исходников)
	return path.join(__dirname, '../workspace-templates');
}

/**
 * Рекурсивно копирует директорию
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
	await fs.mkdir(dest, { recursive: true });
	const entries = await fs.readdir(src, { withFileTypes: true });

	for (const entry of entries) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);

		if (entry.isDirectory()) {
			await copyDirectory(srcPath, destPath);
		} else {
			await fs.copyFile(srcPath, destPath);
		}
	}
}

/**
 * Создает временный тестовый workspace на основе шаблона
 */
export async function createTestWorkspace(
	options: TestWorkspaceOptions = {}
): Promise<string> {
	const {
		template = 'minimal-1c-project',
		customFiles = {},
		modifyFiles = {}
	} = options;

	// Создаем временную директорию
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '1c-test-workspace-'));

	// Копируем шаблон, если он указан и не пустой
	if (template !== 'empty-project') {
		const templatePath = path.join(getFixturesPath(), template);
		try {
			await copyDirectory(templatePath, tempDir);
		} catch (error) {
			throw new Error(
				`Не удалось скопировать шаблон ${template} из ${templatePath}: ${error}`
			);
		}
	}

	// Применяем модификации к существующим файлам
	for (const [filePath, modifier] of Object.entries(modifyFiles)) {
		const fullPath = path.join(tempDir, filePath);
		try {
			const content = await fs.readFile(fullPath, 'utf8');
			const modifiedContent = modifier(content);
			await fs.writeFile(fullPath, modifiedContent, 'utf8');
		} catch (error) {
			console.warn(`Не удалось модифицировать файл ${filePath}: ${error}`);
		}
	}

	// Добавляем/перезаписываем кастомные файлы
	for (const [filePath, content] of Object.entries(customFiles)) {
		const fullPath = path.join(tempDir, filePath);
		const dir = path.dirname(fullPath);
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(fullPath, content, 'utf8');
	}

	return tempDir;
}

/**
 * Удаляет временный workspace
 */
export async function cleanupTestWorkspace(workspacePath: string): Promise<void> {
	try {
		await fs.rm(workspacePath, { recursive: true, force: true });
	} catch (error) {
		console.error(`Ошибка при удалении тестового workspace: ${error}`);
	}
}

/**
 * Получить содержимое файла из шаблона (для чтения эталонных данных)
 */
export async function readFixtureFile(
	template: string,
	filePath: string
): Promise<string> {
	const templatePath = path.join(getFixturesPath(), template, filePath);
	return await fs.readFile(templatePath, 'utf8');
}

/**
 * Валидирует структуру шаблона
 */
export async function validateTemplate(template: string): Promise<boolean> {
	const templatePath = path.join(getFixturesPath(), template);
	const requiredFiles = ['Configuration.xml', 'packagedef'];

	for (const file of requiredFiles) {
		const filePath = path.join(templatePath, file);
		try {
			await fs.access(filePath);
		} catch {
			throw new Error(`Шаблон ${template} не содержит обязательный файл: ${file}`);
		}
	}

	return true;
}

