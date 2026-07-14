import * as assert from 'node:assert';
import {
	detectShellType,
	escapeCommandArgs,
	normalizeArgForShell,
	buildCommand,
	joinCommands,
	type ShellType
} from '../../utils/commandUtils';

suite('commandUtils', () => {
	// Установка кодировки (chcp/[Console]::OutputEncoding) добавляется только на Windows
	// (см. buildCommand → process.platform === 'win32'), поэтому соответствующие проверки
	// выполняем только там.
	const winTest = process.platform === 'win32' ? test : test.skip;

	test('detectShellType возвращает валидный тип оболочки', () => {
		const shell = detectShellType();
		const validShells: ShellType[] = ['cmd', 'powershell', 'bash', 'sh', 'zsh'];
		assert.ok(validShells.includes(shell), `Тип оболочки ${shell} не является валидным`);
	});

	test('escapeCommandArgs экранирует аргументы с пробелами для bash', () => {
		const args = ['path/to/file', 'value with spaces', '--option'];
		const result = escapeCommandArgs(args, 'bash');
		assert.ok(result.includes("'value with spaces'"), 'Аргумент с пробелами должен быть в одинарных кавычках');
		assert.ok(result.includes('path/to/file'), 'Аргумент без пробелов не должен быть в кавычках');
	});

	test('escapeCommandArgs не даёт bash раскрыть $runnerRoot', () => {
		const result = escapeCommandArgs(['--execute', '$runnerRoot/epf/ЗакрытьПредприятие.epf'], 'bash');
		assert.ok(
			result.includes("'$runnerRoot/epf/ЗакрытьПредприятие.epf'"),
			'Аргумент с $ должен быть в одинарных кавычках, чтобы оболочка не раскрыла переменную'
		);
	});

	test('escapeCommandArgs экранирует аргументы с пробелами для PowerShell', () => {
		const args = ['path/to/file', 'value with spaces'];
		const result = escapeCommandArgs(args, 'powershell');
		assert.ok(result.includes("'value with spaces'"), 'Аргумент с пробелами должен быть в одинарных кавычках для PowerShell');
	});

	test('escapeCommandArgs экранирует аргументы с точкой с запятой для PowerShell', () => {
		const args = ['command1;command2'];
		const result = escapeCommandArgs(args, 'powershell');
		assert.ok(result.includes("'command1;command2'"), 'Аргумент с точкой с запятой должен быть экранирован для PowerShell');
	});

	test('normalizeArgForShell преобразует пути для bash на Windows', () => {
		if (process.platform === 'win32') {
			const result = normalizeArgForShell(String.raw`path\to\file`, 'bash');
			assert.strictEqual(result, 'path/to/file', 'Обратные слэши должны быть преобразованы в прямые для bash');
		}
	});

	test('normalizeArgForShell не изменяет параметры команд', () => {
		const result = normalizeArgForShell('--ibconnection', 'bash');
		assert.strictEqual(result, '--ibconnection', 'Параметры команд не должны изменяться');
	});

	winTest('buildCommand формирует команду для PowerShell с кодировкой', () => {
		const result = buildCommand('vrunner.bat', ['init-dev', '--ibconnection', '/F./build/ib'], 'powershell');
		assert.ok(result.includes('[Console]::OutputEncoding'), 'Команда для PowerShell должна содержать установку кодировки');
		assert.ok(result.includes('vrunner.bat'), 'Команда должна содержать путь к исполняемому файлу');
		assert.ok(result.includes('init-dev'), 'Команда должна содержать аргументы');
	});

	winTest('buildCommand формирует команду для cmd с кодировкой', () => {
		const result = buildCommand('vrunner.bat', ['init-dev'], 'cmd');
		assert.ok(result.includes('chcp 65001'), 'Команда для cmd должна содержать установку кодировки');
		assert.ok(result.includes('vrunner.bat'), 'Команда должна содержать путь к исполняемому файлу');
	});

	winTest('buildCommand формирует команду для bash с кодировкой chcp.com', () => {
		const result = buildCommand('vrunner', ['init-dev'], 'bash');
		assert.ok(result.includes('chcp.com 65001 >/dev/null'), 'Команда для bash должна содержать chcp.com: консоль общая с Windows');
		assert.ok(!result.includes('[Console]::OutputEncoding'), 'Команда для bash не должна содержать установку кодировки PowerShell');
		assert.ok(result.includes('vrunner'), 'Команда должна содержать путь к исполняемому файлу');
	});

	test('joinCommands объединяет команды для PowerShell через точку с запятой', () => {
		const commands = ['command1', 'command2', 'command3'];
		const result = joinCommands(commands, 'powershell');
		assert.ok(result.includes(';'), 'Команды для PowerShell должны разделяться точкой с запятой');
		assert.ok(result.includes('command1'), 'Результат должен содержать все команды');
		assert.ok(result.includes('command2'), 'Результат должен содержать все команды');
		assert.ok(result.includes('command3'), 'Результат должен содержать все команды');
	});

	test('joinCommands объединяет команды для cmd через &&', () => {
		const commands = ['command1', 'command2'];
		const result = joinCommands(commands, 'cmd');
		assert.ok(result.includes('&&'), 'Команды для cmd должны разделяться &&');
		assert.ok(result.includes('command1'), 'Результат должен содержать все команды');
		assert.ok(result.includes('command2'), 'Результат должен содержать все команды');
	});

	test('joinCommands объединяет команды для bash через &&', () => {
		const commands = ['command1', 'command2'];
		const result = joinCommands(commands, 'bash');
		assert.ok(result.includes('&&'), 'Команды для bash должны разделяться &&');
		assert.ok(result.includes('command1'), 'Результат должен содержать все команды');
		assert.ok(result.includes('command2'), 'Результат должен содержать все команды');
	});

	test('joinCommands обрабатывает пустой массив', () => {
		const result = joinCommands([], 'bash');
		assert.strictEqual(result, '', 'Пустой массив должен возвращать пустую строку');
	});

	test('joinCommands обрабатывает одну команду', () => {
		const result = joinCommands(['command1'], 'bash');
		assert.strictEqual(result, 'command1', 'Одна команда должна возвращаться без разделителей');
	});
});

