import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { rememberTaskProject } from '../../features/tasks/terminalProjects';
import { VRUNNER_TASK_SOURCE } from '../../features/tasks/vrunnerTask';
import {
	SourceTerminalLinkProvider,
	findTerminalLinkMatches,
	resolveMetadataInRoots,
	resolveTerminalLinkTarget,
} from '../../features/tools/terminalLinks';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { runWithProject } from '../../shared/workspaceProjects';

const idleToken = { isCancellationRequested: false } as vscode.CancellationToken;

function terminalAt(name = 'терминал'): vscode.Terminal {
	return { name } as vscode.Terminal;
}

suite('terminalLinks', () => {
	test('OneScript: путь модуля и номер строки из одного сообщения', () => {
		const line = String.raw`ОШИБКА - {Модуль C:\vr3\src\cli\ПодкомандаValidateSyntaxcheck.os / Ошибка в строке: 188 / Обнаружены ошибки}`;

		const matches = findTerminalLinkMatches(line);

		assert.strictEqual(matches.length, 1);
		assert.deepStrictEqual(matches[0].target, {
			kind: 'file',
			file: String.raw`C:\vr3\src\cli\ПодкомандаValidateSyntaxcheck.os`,
			line: 188,
		});
		assert.strictEqual(line.slice(matches[0].startIndex, matches[0].startIndex + matches[0].length).endsWith('.os'), true);
	});

	test('замечание синтаксического контроля: путь по метаданным', () => {
		const line = 'ПРЕДУПРЕЖДЕНИЕ -   HTTPСервис.Биллинг.Модуль Возможно ошибочный метод: "УдалитьЗапись"';

		const matches = findTerminalLinkMatches(line);

		assert.strictEqual(matches.length, 1);
		assert.deepStrictEqual(matches[0].target, {
			kind: 'metadata',
			metadataPath: 'HTTPСервис.Биллинг.Модуль',
			line: undefined,
		});
	});

	test('путь по метаданным с номером строки', () => {
		const matches = findTerminalLinkMatches('Ошибка в ОбщийМодуль.РаботаСФайлами.Модуль(42): переменная не определена');

		assert.strictEqual(matches.length, 1);
		assert.deepStrictEqual(matches[0].target, {
			kind: 'metadata',
			metadataPath: 'ОбщийМодуль.РаботаСФайлами.Модуль',
			line: 42,
		});
	});

	test('форма объекта: пять сегментов пути', () => {
		const matches = findTerminalLinkMatches('Справочник.Валюты.Форма.ФормаЭлемента.Форма проверена');

		assert.strictEqual(matches.length, 1);
		assert.strictEqual(
			(matches[0].target as { metadataPath: string }).metadataPath,
			'Справочник.Валюты.Форма.ФормаЭлемента.Форма'
		);
	});

	test('обычный путь, скобки и Markdown не размечаются', () => {
		for (const line of [
			'src/cf/CommonModules/Имя/Ext/Module.bsl:12 предупреждение',
			'Выполняю ./features/Справочники/Валюты.feature',
			String.raw`D:\проект\src\cf\CommonModules\Имя\Ext\Module.bsl(7)`,
			'Отчёт (docs/a.md)',
			'[Отчёт](docs/a.md)',
			'Module.bsl(12)',
			'(A.bsl)(B.bsl)',
		]) {
			assert.deepStrictEqual(findTerminalLinkMatches(line), [], line);
		}
	});

	test('строка без путей не даёт ссылок', () => {
		assert.deepStrictEqual(findTerminalLinkMatches('ИНФОРМАЦИЯ - Тестирование поведения завершено'), []);
	});
});

suite('terminalLinks: поиск модуля по метаданным', () => {
	const fixtures = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout');
	const designer = { dir: path.join(fixtures, 'designer', 'src', 'cf'), format: 'designer' as const };
	const edt = { dir: path.join(fixtures, 'edt-workspace', 'ssl31'), format: 'edt' as const };

	test('выгрузка конфигуратора: модуль лежит в Ext', async () => {
		const found = await resolveMetadataInRoots('ОбщийМодуль.ОбщийТест.Модуль', [designer]);

		assert.strictEqual(found, path.join(designer.dir, 'CommonModules', 'ОбщийТест', 'Ext', 'Module.bsl'));
	});

	test('EDT: модуль лежит в src без Ext', async () => {
		const found = await resolveMetadataInRoots('ОбщийМодуль.ОбщийТест.Модуль', [edt]);

		assert.strictEqual(found, path.join(edt.dir, 'src', 'CommonModules', 'ОбщийТест', 'Module.bsl'));
	});

	test('EDT: модуль формы объекта', async () => {
		const found = await resolveMetadataInRoots('Справочник.Валюты.Форма.ФормаСписка.Форма', [edt]);

		assert.strictEqual(
			found,
			path.join(edt.dir, 'src', 'Catalogs', 'Валюты', 'Forms', 'ФормаСписка', 'Module.bsl')
		);
	});

	test('две раскладки рядом: берётся тот корень, где файл есть', async () => {
		const found = await resolveMetadataInRoots('Справочник.Валюты.Форма.ФормаСписка.Форма', [designer, edt]);

		assert.strictEqual(found?.startsWith(edt.dir), true, 'в выгрузке конфигуратора такого файла нет');
	});

	test('несуществующий объект не даёт пути', async () => {
		assert.strictEqual(await resolveMetadataInRoots('ОбщийМодуль.НетТакого.Модуль', [designer, edt]), undefined);
	});
});

suite('terminalLinks: провайдер', () => {
	const provider = new SourceTerminalLinkProvider(VRunnerManager.getInstance());
	const designer = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout/designer');

	test('ссылка открывает модуль проекта задачи, напечатавшей строку', async () => {
		const terminal = terminalAt('Синтаксический контроль проекта');
		rememberTaskProject({ name: terminal.name, source: VRUNNER_TASK_SOURCE }, designer);

		const links = await runWithProject(path.resolve('/w/другой'), () =>
			provider.provideTerminalLinks({ line: 'ОбщийМодуль.ОбщийТест.Модуль(3)', terminal }, idleToken)
		);

		assert.strictEqual(links.length, 1);
		assert.strictEqual(links[0].root, designer);
		assert.strictEqual(
			links[0].resolvedFile,
			path.join(designer, 'src', 'cf', 'CommonModules', 'ОбщийТест', 'Ext', 'Module.bsl')
		);
		assert.strictEqual(links[0].target.kind === 'metadata' ? links[0].target.line : undefined, 3);
		assert.strictEqual(
			await resolveTerminalLinkTarget(links[0].target, links[0].root),
			links[0].resolvedFile
		);
	});

	test('несуществующий модуль и обычный путь не заявляются', async () => {
		const terminal = terminalAt();
		for (const line of [
			'ОбщийМодуль.НетТакого.Модуль',
			'Module.bsl:12',
			'Отчёт (docs/a.md)',
			'[Отчёт](docs/a.md)',
		]) {
			const links = await provider.provideTerminalLinks({ line, terminal }, idleToken);
			assert.deepStrictEqual(links, [], line);
		}
	});

	test('сообщение OneScript без файла на диске не заявляется', async () => {
		const line = String.raw`{Модуль C:\нет\такого\cmdline.os / Ошибка в строке: 4 / текст}`;
		const links = await provider.provideTerminalLinks({ line, terminal: terminalAt() }, idleToken);
		assert.deepStrictEqual(links, []);
	});

	test('отмена не возвращает ссылку', async () => {
		const links = await provider.provideTerminalLinks(
			{ line: 'ОбщийМодуль.ОбщийТест.Модуль', terminal: terminalAt() },
			{ isCancellationRequested: true } as vscode.CancellationToken
		);
		assert.deepStrictEqual(links, []);
	});

	test('сообщение OneScript открывает файл и выделяет указанную строку', async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-link-os-'));
		const file = path.join(directory, 'cmdline.os');
		try {
			await fs.writeFile(file, Array.from({ length: 8 }, (_, index) => `// Строка ${index + 1}`).join('\n'));
			const line = `{Модуль ${file} / Ошибка в строке: 4 / текст}`;
			const links = await provider.provideTerminalLinks({ line, terminal: terminalAt() }, idleToken);

			assert.strictEqual(links.length, 1);
			assert.deepStrictEqual(links[0].target, { kind: 'file', file, line: 4 });
			assert.strictEqual(line.slice(links[0].startIndex, links[0].startIndex + links[0].length), file);
			await provider.handleTerminalLink(links[0]);

			const editor = vscode.window.activeTextEditor;
			assert.ok(editor);
			assert.strictEqual(editor.document.uri.fsPath.toLowerCase(), file.toLowerCase());
			assert.strictEqual(editor.selection.active.line, 3);
		} finally {
			for (const group of vscode.window.tabGroups.all) {
				for (const tab of group.tabs) {
					if (tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === file) {
						await vscode.window.tabGroups.close(tab);
					}
				}
			}
			await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
		}
	});
});
