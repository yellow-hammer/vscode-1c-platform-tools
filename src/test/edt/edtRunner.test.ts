import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	buildEdtArgs,
	describeEdtFailure,
	EDT_NOT_FOUND_MESSAGE,
	edtErrorLine,
	edtFailureMessage,
	edtRunResult,
	edtStagingRoot,
	edtWorkspaceDir,
	explainEdtFailure,
	outputTail,
	runEdtCommand,
	type EdtCommand,
	type EdtSettings,
} from '../../features/edt/edtRunner';
import { TaskOutputChain } from '../../features/tasks/vrunnerTask';
import { decodeProcessOutput } from '../../shared/processOutput';

type GetConfiguration = typeof vscode.workspace.getConfiguration;
type ShowErrorMessage = typeof vscode.window.showErrorMessage;

/** Настройки по умолчанию для сборки вызова. */
function settings(overrides: Partial<EdtSettings> = {}): EdtSettings {
	return { path: '', version: '', workspace: '', timeoutSeconds: 3600, vmargs: [], ...overrides };
}

suite('запуск команд EDT', () => {
	test('рабочая область и общие параметры идут до -command', () => {
		const args = buildEdtArgs(
			{
				command: 'validate',
				args: ['--project-list', 'ssl31'],
				title: 'Проверить проект 1C:EDT',
				workspaceDir: 'C:/проект/build/edt-workspace',
				cwd: 'C:/проект',
			},
			settings()
		);

		assert.deepStrictEqual(args, [
			'-data',
			'C:/проект/build/edt-workspace',
			'-timeout',
			'3600',
			'-command',
			'validate',
			'--project-list',
			'ssl31',
		]);
	});

	test('аргументы JVM идут одним -vmargs перед -command', () => {
		const args = buildEdtArgs(
			{ command: 'build', args: [], title: 'Сборка', workspaceDir: 'ws', cwd: '.' },
			settings({ vmargs: ['-Xmx8g', '-Dfile.encoding=UTF-8'] })
		);

		assert.deepStrictEqual(args, [
			'-data',
			'ws',
			'-timeout',
			'3600',
			'-vmargs',
			'-Xmx8g',
			'-Dfile.encoding=UTF-8',
			'-command',
			'build',
		]);
	});

	test('таймаут берётся из настроек', () => {
		const args = buildEdtArgs(
			{ command: 'export', args: [], title: 'Выгрузка', workspaceDir: 'ws', cwd: '.' },
			settings({ timeoutSeconds: 7200 })
		);

		assert.strictEqual(args[args.indexOf('-timeout') + 1], '7200');
	});

	test('рабочая область по умолчанию лежит в каталоге сборки', () => {
		const dir = edtWorkspaceDir('C:/проект', 'build', settings());

		assert.strictEqual(dir, path.join('C:/проект', 'build', 'edt-workspace'));
	});

	test('у проекта EDT, открытого как рабочая область, рабочая область во временном каталоге', () => {
		const project = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout/edt-workspace/ssl31');

		const dir = edtWorkspaceDir(project, 'build', settings());

		assert.ok(dir.startsWith(os.tmpdir()), dir);
		assert.ok(!dir.startsWith(project), dir);
		assert.strictEqual(path.basename(dir), 'edt-workspace');
		assert.ok(path.basename(path.dirname(dir)).startsWith('ssl31-'), dir);
		assert.strictEqual(edtStagingRoot(project, 'build'), path.dirname(dir));
		assert.strictEqual(edtStagingRoot('C:/проект', 'build'), 'build');
	});

	test('настроенная рабочая область может быть относительной и абсолютной', () => {
		// Абсолютный путь берётся от корня текущей системы: на Linux «D:/ws» не абсолютен
		const absolute = path.join(path.parse(process.cwd()).root, 'едт-рабочая-область');

		assert.strictEqual(
			edtWorkspaceDir('C:/проект', 'build', settings({ workspace: 'едт' })),
			path.join('C:/проект', 'едт')
		);
		assert.strictEqual(edtWorkspaceDir('C:/проект', 'build', settings({ workspace: absolute })), absolute);
	});
});

suite('причина неудачной команды 1cedtcli', () => {
	// Строки вывода 1C:EDT 2026.1
	test('занятая рабочая область', () => {
		const output =
			"Не удалось запустить 1C:EDT CLI по причине того, что рабочая область 'C:\\проект\\build\\edt-workspace' уже используется другим приложением.";

		assert.ok(explainEdtFailure(output)?.includes('Рабочая область 1C:EDT занята'));
		assert.ok(
			explainEdtFailure(
				"Could not launch 1C:EDT CLI because the associated workspace 'C:\\ws' is currently in use by another application."
			)?.includes('занята')
		);
	});

	test('проект уже подключён или его нет', () => {
		assert.strictEqual(
			explainEdtFailure('edtsh: Проект с именем ext-edt уже существует в рабочей области'),
			'Проект ext-edt уже подключён к рабочей области 1C:EDT.'
		);
		assert.strictEqual(
			explainEdtFailure('Project not found: НетТакогоПроекта\n'),
			'Проекта НетТакогоПроекта нет в рабочей области 1C:EDT.'
		);
	});

	test('английский текст отказов о проекте в рабочей области', () => {
		assert.strictEqual(
			explainEdtFailure('edtsh: Workspace project with name tiny-edt already exist\r\n'),
			'Проект tiny-edt уже подключён к рабочей области 1C:EDT.'
		);
		assert.strictEqual(
			explainEdtFailure('edtsh: Workspace project with name NoSuchProject does not exist\r\n'),
			'Проекта NoSuchProject нет в рабочей области 1C:EDT.'
		);
	});

	test('нераспознанный вывод не объясняется', () => {
		assert.strictEqual(explainEdtFailure('java.lang.OutOfMemoryError: Java heap space'), undefined);
	});

	test('распознанный отказ объясняется и в сообщении', () => {
		assert.strictEqual(
			describeEdtFailure('edtsh: Не найдено проекта с именем НетТакогоПроекта в рабочей области\r\n', 204),
			'Проекта НетТакогоПроекта нет в рабочей области 1C:EDT.'
		);
	});
});

suite('нераспознанный отказ 1cedtcli', () => {
	// Вывод 1C:EDT 2026.1 целиком, код возврата 204; английский текст с -nl en
	const UNKNOWN_COMMAND = "Команда не найдена. Введите 'help' для получения списка доступных команд.\r\n";
	const UNKNOWN_COMMAND_EN = "Command not found. Run 'help' for the list of available commands.\r\n";
	const NO_CALL_VARIANT = [
		'Не найден вариант вызова команды, подходящий под переданные аргументы.',
		'Варианты вызова:',
		'1. export --project "строка" --configuration-files "строка"',
		'2. export --project-name "строка" --configuration-files "строка"',
		'',
	].join('\r\n');
	const NO_CALL_VARIANT_EN = [
		'No command call variant was found that matched the passed arguments.',
		'Call variants:',
		'1. export --project "string" --configuration-files "string"',
		'2. export --project-name "string" --configuration-files "string"',
		'',
	].join('\r\n');

	test('неизвестная команда показывается строкой 1cedtcli с кодом возврата', () => {
		assert.strictEqual(
			describeEdtFailure(UNKNOWN_COMMAND, 204),
			"Команда 1C:EDT завершилась с кодом 204: Команда не найдена. Введите 'help' для получения списка доступных команд."
		);
		assert.strictEqual(
			describeEdtFailure(UNKNOWN_COMMAND_EN, 204),
			"Команда 1C:EDT завершилась с кодом 204: Command not found. Run 'help' for the list of available commands."
		);
	});

	test('неподходящие аргументы показываются первой строкой отказа', () => {
		assert.strictEqual(
			describeEdtFailure(NO_CALL_VARIANT, 204),
			'Команда 1C:EDT завершилась с кодом 204: Не найден вариант вызова команды, подходящий под переданные аргументы.'
		);
		assert.strictEqual(
			describeEdtFailure(NO_CALL_VARIANT_EN, 204),
			'Команда 1C:EDT завершилась с кодом 204: No command call variant was found that matched the passed arguments.'
		);
	});

	test('причиной берётся первая строка, а не подробность со словом «Ошибка»', () => {
		const output = [
			'edtsh: Возникли ошибки при экспорте проекта в формат платформы',
			'Ошибка экспорта во внешний поток для Languages\\Русский.xml',
			'Ошибка экспорта во внешний поток для Configuration.xml',
			'',
		].join('\r\n');

		assert.strictEqual(edtErrorLine(output), 'edtsh: Возникли ошибки при экспорте проекта в формат платформы');
	});

	test('шум EDT и стек Java причиной не становятся', () => {
		const output = [
			'[Fatal Error] :1:1: Premature end of file.',
			'',
			'org.osgi.framework.BundleException: Could not resolve module: com.e1c.edt.ai.ui',
			'  Unresolved requirement: Require-Bundle: com.e1c.edt.ai.core',
			'java.lang.IllegalArgumentException: Unsupported class file major version 65',
			'\tat org.objectweb.asm.ClassReader.<init>(ClassReader.java:199)',
			'\t... 12 more',
			'Caused by: java.lang.IllegalStateException: weaving hook failed',
			'\tat org.eclipse.equinox.weaving.hooks.WeavingHook.processClass(WeavingHook.java:120)',
			'',
			NO_CALL_VARIANT,
		].join('\r\n');

		assert.strictEqual(
			edtErrorLine(output),
			'Не найден вариант вызова команды, подходящий под переданные аргументы.'
		);
		assert.strictEqual(
			describeEdtFailure('[Fatal Error] :1:1: Premature end of file.\r\n', 204),
			'Команда 1C:EDT завершилась с кодом 204.'
		);
	});

	test('стек Java без строк шума перед ним причиной не становится', () => {
		const output = [
			'\tat a.b.C.d(C.java:1)',
			'\t... 3 more',
			'Caused by: java.lang.IllegalStateException: x',
			'\tat a.b.C.e(C.java:2)',
			'',
			NO_CALL_VARIANT,
		].join('\r\n');

		assert.strictEqual(edtErrorLine(output), 'Не найден вариант вызова команды, подходящий под переданные аргументы.');
	});

	test('пустая строка заканчивает блок шума', () => {
		const output = [
			'[Fatal Error] :1:1: Premature end of file.',
			'',
			'  edtsh: Не найдено файлов платформенной XML выгрузки в C:\\dump',
			'',
		].join('\r\n');

		assert.strictEqual(edtErrorLine(output), 'edtsh: Не найдено файлов платформенной XML выгрузки в C:\\dump');
	});

	test('без вывода остаётся код возврата', () => {
		assert.strictEqual(edtErrorLine(''), undefined);
		assert.strictEqual(edtErrorLine('\r\n  \r\n'), undefined);
		assert.strictEqual(describeEdtFailure('', 1), 'Команда 1C:EDT завершилась с кодом 1.');
	});

	test('отказ лаунчера в UTF-16LE читается', () => {
		const stderr = Buffer.from(
			'Failed to copy file C:\\edt\\1cedtcli-startup.txt to C:\\Temp\\1cedtcli-startup.txt: Процесс не может получить доступ к файлу\r\n',
			'utf16le'
		);

		assert.strictEqual(
			describeEdtFailure(decodeProcessOutput(stderr), 1),
			'Команда 1C:EDT завершилась с кодом 1: Failed to copy file C:\\edt\\1cedtcli-startup.txt to C:\\Temp\\1cedtcli-startup.txt: Процесс не может получить доступ к файлу'
		);
	});

	test('причина есть только у неудачи, которую не останавливали', () => {
		assert.deepStrictEqual(edtRunResult(0, UNKNOWN_COMMAND, false), { exitCode: 0 });
		assert.deepStrictEqual(edtRunResult(204, UNKNOWN_COMMAND, true), { exitCode: 204 });
		assert.deepStrictEqual(edtRunResult(204, UNKNOWN_COMMAND, false), {
			exitCode: 204,
			error: "Команда 1C:EDT завершилась с кодом 204: Команда не найдена. Введите 'help' для получения списка доступных команд.",
		});
	});

	test('сообщение шага дополняется причиной, если она есть', () => {
		const summary = 'Выгрузка проекта 1C:EDT не удалась, команда не запущена.';

		assert.strictEqual(
			edtFailureMessage(summary, { exitCode: 204, error: describeEdtFailure(UNKNOWN_COMMAND, 204) }),
			`${summary} Команда 1C:EDT завершилась с кодом 204: Команда не найдена. Введите 'help' для получения списка доступных команд.`
		);
		assert.strictEqual(edtFailureMessage(summary, { exitCode: 1 }), summary);
	});

	test('хвост длинного вывода начинается с целой строки', () => {
		const output = `${'прогресс\n'.repeat(10)}${UNKNOWN_COMMAND}`;

		assert.strictEqual(outputTail(output, UNKNOWN_COMMAND.length + 3), UNKNOWN_COMMAND);
		assert.strictEqual(outputTail(output, UNKNOWN_COMMAND.length + 9), `прогресс\n${UNKNOWN_COMMAND}`);
		assert.strictEqual(outputTail(output, output.length), output);
		assert.strictEqual(edtErrorLine(outputTail(output, UNKNOWN_COMMAND.length + 3)), UNKNOWN_COMMAND.trim());
	});
});

suite('команда EDT, которую ждёт вызывающий', () => {
	const workspace = vscode.workspace as unknown as { getConfiguration: GetConfiguration };
	const window = vscode.window as unknown as { showErrorMessage: ShowErrorMessage };
	const originalConfiguration = workspace.getConfiguration;
	const originalShowError = window.showErrorMessage;
	let installDir: string;
	let errors: string[];

	setup(() => {
		installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edt-установка-'));
		errors = [];
		// Настроенный каталог установки единственный: EDT этой машины тест не найдёт
		workspace.getConfiguration = ((section?: string, scope?: vscode.ConfigurationScope | null) => {
			const config = originalConfiguration(section, scope);
			if (section !== '1c-platform-tools') {
				return config;
			}
			return {
				get: (key: string, defaultValue?: unknown) => (key === 'edt.path' ? installDir : config.get(key, defaultValue)),
				has: (key: string) => config.has(key),
				inspect: (key: string) => config.inspect(key),
				update: config.update.bind(config),
			} as vscode.WorkspaceConfiguration;
		}) as GetConfiguration;
		window.showErrorMessage = ((message: string) => {
			errors.push(message);
			return Promise.resolve(undefined);
		}) as ShowErrorMessage;
	});

	teardown(() => {
		workspace.getConfiguration = originalConfiguration;
		window.showErrorMessage = originalShowError;
		fs.rmSync(installDir, { recursive: true, force: true });
	});

	function request(output: TaskOutputChain): EdtCommand {
		return {
			command: 'project-info',
			args: ['проект'],
			title: 'EDT: сведения о проекте',
			workspaceDir: path.join(installDir, 'edt-workspace'),
			cwd: installDir,
			output,
		};
	}

	test('отказ запуска уходит вызывающему без окна, при ручном запуске показывается окном', async () => {
		const notFound = { exitCode: 1, error: EDT_NOT_FOUND_MESSAGE };

		assert.deepStrictEqual(await runEdtCommand(request(new TaskOutputChain(true))), notFound);
		assert.deepStrictEqual(errors, []);

		assert.deepStrictEqual(await runEdtCommand(request(new TaskOutputChain())), notFound);
		assert.deepStrictEqual(errors, [EDT_NOT_FOUND_MESSAGE]);
	});

	test('1cedtcli идёт без терминала, причина отказа доходит до вызывающего', async function () {
		// На Windows установка EDT - это 1cedtcli.exe: сценарием её не подставить
		if (process.platform === 'win32') {
			this.skip();
		}
		this.timeout(10_000);
		const cli = path.join(installDir, '1cedtcli');
		fs.writeFileSync(cli, '#!/bin/sh\necho "edtsh: Не найдено проекта с именем проект в рабочей области" >&2\nexit 13\n', 'utf8');
		fs.chmodSync(cli, 0o755);
		const opened: vscode.Terminal[] = [];
		const listener = vscode.window.onDidOpenTerminal((terminal) => opened.push(terminal));

		try {
			const result = await runEdtCommand(request(new TaskOutputChain(true)));

			assert.deepStrictEqual(result, { exitCode: 13, error: 'Проекта проект нет в рабочей области 1C:EDT.' });
			assert.deepStrictEqual(opened, []);
		} finally {
			listener.dispose();
		}
	});
});
