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
import { runWithProject, sameProjectRoot } from '../../shared/workspaceProjects';

suite('terminalLinks', () => {
	test('OneScript: путь модуля и номер строки из одного сообщения', () => {
		// Строка из живого прогона vanessa-runner 3
		const line = String.raw`ОШИБКА - {Модуль C:\vr3\src\cli\ПодкомандаValidateSyntaxcheck.os / Ошибка в строке: 188 / Обнаружены ошибки}`;

		const matches = findTerminalLinkMatches(line);

		assert.strictEqual(matches.length, 1);
		assert.deepStrictEqual(matches[0].target, {
			kind: 'file',
			file: String.raw`C:\vr3\src\cli\ПодкомандаValidateSyntaxcheck.os`,
			line: 188,
		});
		assert.strictEqual(line.substr(matches[0].startIndex, matches[0].length).endsWith('.os'), true);
	});

	test('замечание синтаксического контроля: путь по метаданным', () => {
		// Строка из живого прогона: путь и текст замечания идут через пробел
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

	test('относительный путь без ./ берётся целиком, а не от внутреннего слэша', () => {
		const line = 'src/cf/CommonModules/Имя/Ext/Module.bsl:12 предупреждение';

		const matches = findTerminalLinkMatches(line);

		assert.strictEqual(matches.length, 1);
		assert.deepStrictEqual(matches[0].target, {
			kind: 'file',
			file: 'src/cf/CommonModules/Имя/Ext/Module.bsl',
			line: 12,
		});
		assert.strictEqual(matches[0].startIndex, 0, 'ссылка начинается с начала пути');
	});

	test('относительный путь к фиче', () => {
		const matches = findTerminalLinkMatches('Выполняю ./features/Справочники/Валюты.feature');

		assert.strictEqual(matches.length, 1);
		assert.deepStrictEqual(matches[0].target, {
			kind: 'file',
			file: './features/Справочники/Валюты.feature',
			line: undefined,
		});
	});

	test('абсолютный путь с номером строки в скобках', () => {
		const line = String.raw`D:\проект\src\cf\CommonModules\Имя\Ext\Module.bsl(7)`;

		const matches = findTerminalLinkMatches(line);

		assert.strictEqual(matches.length, 1);
		assert.deepStrictEqual(matches[0].target, {
			kind: 'file',
			file: String.raw`D:\проект\src\cf\CommonModules\Имя\Ext\Module.bsl`,
			line: 7,
		});
	});

	for (const { name, line, file, clickable, lineNumber } of [
		{
			name: 'путь в круглых скобках не включает внешнюю скобку',
			line: 'Отчёт (docs/test.md)',
			file: 'docs/test.md',
			clickable: 'docs/test.md',
			lineNumber: undefined,
		},
		{
			name: 'Markdown-ссылка не включает подпись и скобки',
			line: '[Отчёт](docs/test.md)',
			file: 'docs/test.md',
			clickable: 'docs/test.md',
			lineNumber: undefined,
		},
		{
			name: 'скобки внутри имени файла сохраняются',
			line: 'Отчёт docs/test(итог).md',
			file: 'docs/test(итог).md',
			clickable: 'docs/test(итог).md',
			lineNumber: undefined,
		},
		{
			name: 'внешние скобки не поглощают скобки внутри имени файла',
			line: 'Отчёт (docs/test(итог).md)',
			file: 'docs/test(итог).md',
			clickable: 'docs/test(итог).md',
			lineNumber: undefined,
		},
		{
			name: 'имя файла в подписи Markdown не становится отдельной ссылкой',
			line: '[guide.md](docs/test.md)',
			file: 'docs/test.md',
			clickable: 'docs/test.md',
			lineNumber: undefined,
		},
		{
			name: 'вложенные скобки внутри пути сохраняются',
			line: '[Отчёт](docs/test(итог(2)).md)',
			file: 'docs/test(итог(2)).md',
			clickable: 'docs/test(итог(2)).md',
			lineNumber: undefined,
		},
		{
			name: 'квадратные скобки внутри пути сохраняются',
			line: '[Отчёт](docs/test[итог].md)',
			file: 'docs/test[итог].md',
			clickable: 'docs/test[итог].md',
			lineNumber: undefined,
		},
		{
			name: 'точка после круглых скобок не входит в путь',
			line: 'Отчёт (docs/test.md).',
			file: 'docs/test.md',
			clickable: 'docs/test.md',
			lineNumber: undefined,
		},
		{
			name: 'точка после Markdown-ссылки не входит в путь',
			line: '[Отчёт](docs/test.md).',
			file: 'docs/test.md',
			clickable: 'docs/test.md',
			lineNumber: undefined,
		},
		{
			name: 'многоточие после круглых скобок не входит в путь',
			line: 'Отчёт (docs/test.md)...',
			file: 'docs/test.md',
			clickable: 'docs/test.md',
			lineNumber: undefined,
		},
		{
			name: 'многоточие после Markdown-ссылки не входит в путь',
			line: '[Отчёт](docs/test.md)...',
			file: 'docs/test.md',
			clickable: 'docs/test.md',
			lineNumber: undefined,
		},
		{
			name: 'скобки в начале имени файла сохраняются',
			line: '(name).md',
			file: '(name).md',
			clickable: '(name).md',
			lineNumber: undefined,
		},
		{
			name: 'скобки в начале каталога сохраняются',
			line: '(dir)/file.md',
			file: '(dir)/file.md',
			clickable: '(dir)/file.md',
			lineNumber: undefined,
		},
		{
			name: 'квадратные скобки в начале Windows-каталога сохраняются',
			line: '[dir]\\file.bsl',
			file: '[dir]\\file.bsl',
			clickable: '[dir]\\file.bsl',
			lineNumber: undefined,
		},
		{
			name: 'номер строки внутри внешних скобок сохраняется',
			line: 'Ошибка (src/Module.bsl(12))',
			file: 'src/Module.bsl',
			clickable: 'src/Module.bsl(12)',
			lineNumber: 12,
		},
		{
			name: 'номер строки в Markdown-ссылке сохраняется',
			line: '[Модуль](src/Module.bsl(12))',
			file: 'src/Module.bsl',
			clickable: 'src/Module.bsl(12)',
			lineNumber: 12,
		},
	]) {
		test(name, () => {
			const matches = findTerminalLinkMatches(line);

			assert.strictEqual(matches.length, 1);
			assert.deepStrictEqual(matches[0].target, { kind: 'file', file, line: lineNumber });
			assert.strictEqual(matches[0].startIndex, line.indexOf(clickable));
			assert.strictEqual(matches[0].length, clickable.length);
			assert.strictEqual(line.slice(matches[0].startIndex, matches[0].startIndex + matches[0].length), clickable);
		});
	}

	test('две оформленные ссылки в строке не объединяются и не удваиваются', () => {
		const line = 'Сравнить (docs/before.md) и [После](docs/after.md).';
		const matches = findTerminalLinkMatches(line);

		assert.deepStrictEqual(matches, ['docs/before.md', 'docs/after.md'].map((file) => ({
			startIndex: line.indexOf(file),
			length: file.length,
			target: { kind: 'file', file, line: undefined },
		})));
	});

	test('соседние Markdown-ссылки без пробела остаются отдельными', () => {
		const line = '[До](docs/before.md)[После](docs/after.md)';
		const matches = findTerminalLinkMatches(line);

		assert.deepStrictEqual(matches, ['docs/before.md', 'docs/after.md'].map((file) => ({
			startIndex: line.indexOf(file),
			length: file.length,
			target: { kind: 'file', file, line: undefined },
		})));
	});

	test('путь внутри записи OneScript не удваивается', () => {
		const line = String.raw`{Модуль C:\lib\cmdline.os / Ошибка в строке: 441 / Неизвестный параметр}`;

		const matches = findTerminalLinkMatches(line);

		assert.strictEqual(matches.length, 1, 'общий разбор путей не должен добавить второй фрагмент');
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

suite('terminalLinks: проект команды', () => {
	const designer = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout/designer');

	test('ссылка открывает модуль проекта задачи, напечатавшей строку, а не текущего проекта', async () => {
		const provider = new SourceTerminalLinkProvider(VRunnerManager.getInstance());
		const terminal = { name: 'Синтаксический контроль проекта' } as vscode.Terminal;
		rememberTaskProject({ name: terminal.name, source: VRUNNER_TASK_SOURCE }, designer);

		const links = runWithProject(path.resolve('/w/другой'), () =>
			provider.provideTerminalLinks({ line: 'ОбщийМодуль.ОбщийТест.Модуль(3)', terminal })
		);

		assert.strictEqual(links.length, 1);
		assert.strictEqual(links[0].root, designer);
		assert.strictEqual(
			await resolveTerminalLinkTarget(links[0].target, links[0].root),
			path.join(designer, 'src', 'cf', 'CommonModules', 'ОбщийТест', 'Ext', 'Module.bsl')
		);
	});

	test('в терминале без команд расширения ссылка берёт текущий проект', () => {
		const provider = new SourceTerminalLinkProvider(VRunnerManager.getInstance());
		const root = path.resolve('/w/текущий');

		const links = runWithProject(root, () =>
			provider.provideTerminalLinks({ line: 'src/cf/Module.bsl:3', terminal: { name: 'оболочка пользователя' } as vscode.Terminal })
		);

		assert.strictEqual(links.length, 1);
		assert.ok(links[0].root !== undefined && sameProjectRoot(links[0].root, root));
	});
});


suite('terminalLinks: открытие файла в редакторе', () => {
	test('Markdown-ссылка открывает существующий модуль и выделяет указанную строку', async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-link-test-'));
		const file = path.join(directory, 'Модуль(итог).bsl');
		const uri = vscode.Uri.file(file);

		try {
			await fs.writeFile(file, Array.from({ length: 15 }, (_, index) => `// Строка ${index + 1}`).join('\n'));
			const provider = new SourceTerminalLinkProvider(VRunnerManager.getInstance());
			const links = provider.provideTerminalLinks({
				line: `[Модуль](${file}(12))`,
				terminal: { name: 'проверка открытия ссылки' } as vscode.Terminal,
			});

			assert.strictEqual(links.length, 1);
			await provider.handleTerminalLink(links[0]);

			const editor = vscode.window.activeTextEditor;
			assert.ok(editor, 'обработчик должен открыть текстовый редактор');
			assert.strictEqual(editor.document.uri.toString(), uri.toString());
			assert.strictEqual(editor.selection.active.line, 11, 'строка 12 имеет индекс 11');
			assert.strictEqual(editor.selection.active.character, 0);
		} finally {
			// Закрываем только вкладки собственного временного файла в тестовом хосте.
			for (const group of vscode.window.tabGroups.all) {
				for (const tab of group.tabs) {
					if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()) {
						await vscode.window.tabGroups.close(tab);
					}
				}
			}
			await fs.rm(directory, { recursive: true, force: true });
		}
	});
});
