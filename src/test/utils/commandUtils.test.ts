import * as assert from 'node:assert';
import {
	detectShellType,
	escapeCommandArg,
	escapeCommandArgs,
	normalizeArgForShell,
	buildCommand,
	buildDockerCommand,
	buildDockerCommandSequence,
	buildProcessCommand,
	joinCommands,
	quoteExecutable,
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

	test('escapeCommandArgs для cmd держит --additional с пробелами одним аргументом', () => {
		const additional = '/LoadConfigFromFiles src/cf -updateConfigDumpInfo';
		const result = escapeCommandArgs(['designer', '--additional', additional], 'cmd');
		assert.strictEqual(
			result,
			`designer --additional "${additional}"`,
			'cmd понимает двойные кавычки: иначе src/cf уйдёт позиционным параметром'
		);
	});

	test('escapeCommandArgs для PowerShell оборачивает тот же --additional в одинарные кавычки', () => {
		const additional = '/LoadConfigFromFiles src/cf -updateConfigDumpInfo';
		const result = escapeCommandArgs(['designer', '--additional', additional], 'powershell');
		assert.strictEqual(
			result,
			`designer --additional '${additional}'`,
			'одинарные кавычки PowerShell нельзя подставлять в exec/cmd'
		);
	});

	test('escapeCommandArg берёт в кавычки метасимволы cmd без пробелов', () => {
		assert.strictEqual(escapeCommandArg(String.raw`C:\Dev&Ops\env.json`, 'cmd'), String.raw`"C:\Dev&Ops\env.json"`);
		assert.strictEqual(escapeCommandArg('x|y', 'cmd'), '"x|y"');
		assert.strictEqual(escapeCommandArg('a>b', 'cmd'), '"a>b"');
	});

	test('escapeCommandArg прикрывает кареткой то, что кавычки cmd не держат', () => {
		// Процент раскрывается и внутри кавычек, кавычка рвёт кавычечный контекст
		assert.strictEqual(escapeCommandArg('env%USERNAME%.json', 'cmd'), '^"env^%USERNAME^%.json^"');
		assert.strictEqual(escapeCommandArg('say "hi"', 'cmd'), String.raw`^"say \^"hi\^"^"`);
	});

	test('escapeCommandArg не теряет пустой аргумент', () => {
		assert.strictEqual(escapeCommandArg('', 'cmd'), '""');
		assert.strictEqual(escapeCommandArg('', 'sh'), "''");
		assert.strictEqual(escapeCommandArg('', 'powershell'), "''");
	});

	test('escapeCommandArg берёт в кавычки табуляцию', () => {
		assert.strictEqual(escapeCommandArg('a\tb', 'cmd'), '"a\tb"');
		assert.strictEqual(escapeCommandArg('a\tb', 'sh'), "'a\tb'");
	});

	test('escapeCommandArg удваивает слэши перед кавычкой по правилам argv Windows', () => {
		assert.strictEqual(escapeCommandArg('C:\\Program Files\\', 'cmd'), '"C:\\Program Files\\\\"');
	});

	test('escapeCommandArg закрывает метасимволы POSIX одинарными кавычками', () => {
		assert.strictEqual(escapeCommandArg('a&b', 'sh'), "'a&b'");
		assert.strictEqual(escapeCommandArg('$runnerRoot/x.epf', 'bash'), "'$runnerRoot/x.epf'");
		assert.strictEqual(escapeCommandArg("it's", 'zsh'), String.raw`'it'\''s'`);
	});

	test('escapeCommandArg оставляет безопасный аргумент без кавычек', () => {
		for (const shell of ['cmd', 'powershell', 'bash', 'sh', 'zsh'] as ShellType[]) {
			assert.strictEqual(escapeCommandArg('--ibconnection', shell), '--ibconnection');
			assert.strictEqual(escapeCommandArg('/F./build/ib', shell), '/F./build/ib');
		}
	});

	test('quoteExecutable для cmd берёт путь в обычные кавычки: имя команды ищется по ним', () => {
		assert.strictEqual(
			quoteExecutable(String.raw`C:\Dev&Ops (x86)\vrunner.bat`, 'cmd'),
			String.raw`"C:\Dev&Ops (x86)\vrunner.bat"`
		);
		assert.strictEqual(quoteExecutable('vrunner.bat', 'cmd'), 'vrunner.bat');
	});

	test('quoteExecutable для POSIX берёт путь в одинарные кавычки', () => {
		assert.strictEqual(quoteExecutable('/opt/1c tools/vrunner', 'sh'), "'/opt/1c tools/vrunner'");
		assert.strictEqual(quoteExecutable('/usr/bin/vrunner', 'sh'), '/usr/bin/vrunner');
	});

	test('buildProcessCommand экранирует по оболочке дочернего процесса, а не терминала', () => {
		const result = buildProcessCommand('vrunner', ['designer', '--additional', '/LoadConfigFromFiles src/cf']);
		const expected = process.platform === 'win32'
			? 'chcp 65001 >nul && vrunner designer --additional "/LoadConfigFromFiles src/cf"'
			: "vrunner designer --additional '/LoadConfigFromFiles src/cf'";
		assert.strictEqual(result, expected);
	});

	winTest('buildProcessCommand всегда ставит кодовую страницу: иначе кириллица приходит в OEM', () => {
		for (const executable of ['vrunner', 'opm', 'allure']) {
			assert.ok(
				buildProcessCommand(executable, ['help']).startsWith('chcp 65001 >nul && '),
				`команда ${executable} осталась без установки кодовой страницы`
			);
		}
	});

	test('buildDockerCommand экранирует аргументы для оболочки хоста', () => {
		// ENTRYPOINT задан exec-формой: оболочки в контейнере нет, разбирает строку хост
		const result = buildDockerCommand('vrunner:8.3.27', ['vanessa', '--settings', 'env one.json'], String.raw`C:\ws dir`, 'cmd');
		assert.strictEqual(
			result,
			String.raw`docker run --rm -v "C:\ws dir:/workspace" -w /workspace vrunner:8.3.27 vanessa --settings "env one.json"`
		);
	});

	winTest('buildDockerCommand нормализует путь и кавычки для bash-хоста', () => {
		const result = buildDockerCommand('vrunner:8.3.27', ['vanessa'], String.raw`C:\ws dir`, 'bash');
		assert.strictEqual(result, "docker run --rm -v 'C:/ws dir:/workspace' -w /workspace vrunner:8.3.27 vanessa");
	});

	test('buildDockerCommandSequence отдаёт строку sh одним аргументом хоста', () => {
		const result = buildDockerCommandSequence(
			'vrunner:8.3.27',
			[['vanessa', '--settings', 'env one.json'], ['compile']],
			'/home/ws',
			'cmd'
		);
		assert.strictEqual(
			result,
			'docker run --rm -v /home/ws:/workspace -w /workspace --entrypoint /bin/sh vrunner:8.3.27 -c ' +
			String.raw`"vrunner vanessa --settings 'env one.json' && vrunner compile"`
		);
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

