import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	detectShellType,
	escapeCommandArg,
	escapeCommandArgs,
	normalizeArgForShell,
	buildCommand,
	buildDockerCommand,
	buildDockerCommandSequence,
	buildProcessCommand,
	dockerRunArgs,
	joinCommands,
	normalizeIbPathForDocker,
	quoteExecutable,
	withoutPublishedPorts,
	type ShellType
} from '../../utils/commandUtils';
import { pathConversionPrefix } from '../../utils/shellEscape';
import {
	DOCKER_STOP_TIMEOUT_SECONDS,
	WINDOW_CONTAINER_LABEL,
	dockerCommandRun,
	dockerContainerName,
	startWindowContainer,
	windowContainerLogsRun,
} from '../../shared/dockerRun';

suite('commandUtils', () => {
	// Установка кодировки (chcp/[Console]::OutputEncoding) добавляется только на Windows
	// (см. buildCommand → process.platform === 'win32'), поэтому соответствующие проверки
	// выполняем только там.
	const winTest = process.platform === 'win32' ? test : test.skip;
	const posixTest = process.platform === 'win32' ? test.skip : test;
	// Префикс MSYS есть у sh только на Windows, его проверяет отдельный тест
	const shPrefix = pathConversionPrefix('sh');

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

	test('quoteExecutable для PowerShell ставит оператор вызова перед путём в кавычках', () => {
		assert.strictEqual(
			quoteExecutable(String.raw`C:\Users\ikarl\1C\1C_EDT 2026.1\1cedt\1cedtcli.exe`, 'powershell'),
			String.raw`& 'C:\Users\ikarl\1C\1C_EDT 2026.1\1cedt\1cedtcli.exe'`
		);
		assert.strictEqual(quoteExecutable('vrunner.bat', 'powershell'), 'vrunner.bat');
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
		assert.strictEqual(
			result,
			"MSYS2_ARG_CONV_EXCL='*' docker run --rm -v 'C:/ws dir:/workspace' -w /workspace vrunner:8.3.27 vanessa"
		);
	});

	winTest('команды для bash-подобных оболочек Windows выключают конвертацию путей MSYS', () => {
		const prefix = "MSYS2_ARG_CONV_EXCL='*' ";
		for (const shell of ['bash', 'sh', 'zsh'] as ShellType[]) {
			assert.ok(
				buildCommand('vrunner', ['init-dev', '--ibconnection', '/F./build/ib'], shell).includes(`${prefix}vrunner init-dev`),
				`${shell}: префикс должен стоять прямо перед исполняемым файлом`
			);
			assert.ok(
				buildDockerCommandSequence('vrunner:8.3.27', [['compile']], String.raw`C:\ws`, shell).startsWith(`${prefix}docker run`),
				`${shell}: префикс должен стоять перед docker`
			);
		}
		for (const shell of ['cmd', 'powershell'] as ShellType[]) {
			assert.ok(!buildCommand('vrunner', ['init-dev'], shell).includes('MSYS'), `${shell}: префикс MSYS не нужен`);
			assert.ok(!buildDockerCommand('vrunner:8.3.27', ['compile'], String.raw`C:\ws`, shell).includes('MSYS'), `${shell}: префикс MSYS не нужен`);
		}
		assert.ok(!buildProcessCommand('vrunner', ['init-dev']).includes('MSYS'), 'дочерний процесс идёт через cmd');
	});

	posixTest('вне Windows команды для bash без префикса MSYS', () => {
		assert.strictEqual(buildCommand('vrunner', ['init-dev'], 'bash'), 'vrunner init-dev');
		assert.ok(buildDockerCommand('vrunner:8.3.27', ['compile'], '/home/ws', 'bash').startsWith('docker run'));
	});

	test('buildDockerCommand даёт контейнеру имя: по нему его останавливают при отмене', () => {
		const result = buildDockerCommand('vrunner:8.3.27', ['vanessa'], '/home/ws', 'sh', { containerName: '1cpt-run-test' });
		assert.strictEqual(
			result,
			`${shPrefix}docker run --rm --name 1cpt-run-test -v /home/ws:/workspace -w /workspace vrunner:8.3.27 vanessa`
		);
	});

	test('buildDockerCommand без имени контейнера остаётся прежним', () => {
		const result = buildDockerCommand('vrunner:8.3.27', ['vanessa'], '/home/ws', 'sh');
		assert.strictEqual(result, `${shPrefix}docker run --rm -v /home/ws:/workspace -w /workspace vrunner:8.3.27 vanessa`);
	});

	test('dockerRunArgs отдаёт путь проекта одним аргументом без кавычек', () => {
		assert.deepStrictEqual(
			dockerRunArgs('vrunner:8.3.27', ['vanessa', '--settings', 'env one.json'], String.raw`C:\ws & dir`, { containerName: '1cpt-run-test' }),
			['run', '--rm', '--name', '1cpt-run-test', '-v', String.raw`C:\ws & dir:/workspace`, '-w', '/workspace', 'vrunner:8.3.27', 'vanessa', '--settings', 'env one.json']
		);
	});

	test('buildDockerCommandSequence тоже именует контейнер', () => {
		const result = buildDockerCommandSequence('vrunner:8.3.27', [['compile']], '/home/ws', 'sh', { containerName: '1cpt-run-test' });
		assert.ok(
			result.startsWith(`${shPrefix}docker run --rm --name 1cpt-run-test -v /home/ws:/workspace`),
			`имя контейнера не попало в команду: ${result}`
		);
	});

	test('имя контейнера уникально для каждого запуска', () => {
		const names = new Set(Array.from({ length: 50 }, () => dockerContainerName()));
		assert.strictEqual(names.size, 50, 'имена контейнеров повторяются');
		for (const name of names) {
			assert.match(name, /^1cpt-run-[a-z0-9]+-[a-z0-9]+$/);
		}
	});

	test('запуск в контейнере получает новое имя на каждый вызов', () => {
		const names: string[] = [];
		const build = (name: string): string => {
			names.push(name);
			return `docker run --name ${name}`;
		};

		const first = dockerCommandRun(build);
		const second = dockerCommandRun(build);

		assert.strictEqual(names.length, 2);
		assert.notStrictEqual(names[0], names[1], 'повтор задачи столкнулся бы с именем контейнера, который ещё останавливается');
		assert.strictEqual(first.command, `docker run --name ${names[0]}`);
		assert.strictEqual(second.command, `docker run --name ${names[1]}`);
		assert.strictEqual(typeof first.onCancel, 'function');
	});

	test('отмена в контейнере: удаление ждёт остановки с таймаутом', async () => {
		const calls: string[] = [];
		let finishStop!: () => void;
		const docker = (args: readonly string[]): Promise<void> => {
			calls.push(args.join(' '));
			return args[0] === 'stop' ? new Promise((resolve) => (finishStop = resolve)) : Promise.resolve();
		};
		let name = '';
		const run = dockerCommandRun((containerName) => (name = containerName), docker);

		const stopping = run.onCancel?.();
		run.onCancelled?.();
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.deepStrictEqual(calls, [`stop -t ${DOCKER_STOP_TIMEOUT_SECONDS} ${name}`], 'контейнер удалён до остановки');

		finishStop();
		await stopping;
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.deepStrictEqual(calls, [`stop -t ${DOCKER_STOP_TIMEOUT_SECONDS} ${name}`, `rm -f ${name}`]);
	});

	test('клиент с окном: контейнер отсоединён, с меткой и без --rm', () => {
		assert.deepStrictEqual(
			dockerRunArgs('vrunner:8.3.27-vnc', ['run', 'designer'], '/home/ws', { containerName: 'c', detached: true }),
			['run', '-d', '--label', WINDOW_CONTAINER_LABEL, '--name', 'c', '-v', '/home/ws:/workspace', '-w', '/workspace', 'vrunner:8.3.27-vnc', 'run', 'designer']
		);
	});

	test('клиент с окном: запуск ждёт только старта контейнера, выход убирает его', async () => {
		const calls: string[] = [];
		let finishWait!: (code: string) => void;
		const docker = (args: readonly string[]): Promise<{ stdout: string; error?: string }> => {
			calls.push(args.join(' '));
			if (args[0] === 'wait') {
				return new Promise((resolve) => (finishWait = (code) => resolve({ stdout: `${code}\n` })));
			}
			return Promise.resolve({ stdout: args[0] === 'logs' ? 'Не найдена лицензия' : '' });
		};

		const started = await startWindowContainer(['run', '-d', '--name', 'c', 'image'], 'c', docker);
		assert.ok(!('error' in started));
		assert.deepStrictEqual(calls, [`container prune -f --filter label=${WINDOW_CONTAINER_LABEL}`, 'run -d --name c image', 'wait c']);

		finishWait('1');
		assert.strictEqual(await started.exited, 1);
		assert.deepStrictEqual(calls.slice(3), ['logs --tail 50 c', 'rm -f c']);
	});

	test('клиент с окном: отказ docker run приходит причиной', async () => {
		const docker = (args: readonly string[]): Promise<{ stdout: string; error?: string }> =>
			Promise.resolve(args[0] === 'run' ? { stdout: '', error: 'port is already allocated' } : { stdout: '' });

		assert.deepStrictEqual(await startWindowContainer(['run', '-d', 'image'], 'c', docker), { error: 'port is already allocated' });
	});

	test('клиент с окном: задача показывает вывод, отмена останавливает контейнер', async () => {
		const calls: string[] = [];
		const run = windowContainerLogsRun('c', (args) => {
			calls.push(args.join(' '));
			return Promise.resolve();
		});

		assert.deepStrictEqual(run.command, { file: 'docker', args: ['logs', '-f', 'c'] });
		await run.onCancel?.();
		assert.deepStrictEqual(calls, [`stop -t ${DOCKER_STOP_TIMEOUT_SECONDS} c`]);
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
			'docker run --rm -v /home/ws:/workspace -w /workspace --init -e TINI_KILL_PROCESS_GROUP=1 --entrypoint /bin/sh vrunner:8.3.27 -c ' +
			String.raw`"trap 'exit 143' TERM; trap 'exit 130' INT; vrunner vanessa --settings 'env one.json' && vrunner compile"`
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
	test('dockerRunArgs: тома и параметры docker.runArgs идут до образа', () => {
		assert.deepStrictEqual(
			dockerRunArgs('vrunner:8.3.27', ['load'], '/home/ws', {
				containerName: 'c',
				mounts: [{ host: '/tmp/edt', container: '/edt-staging' }],
				runArgs: ['--network', 'host'],
			}),
			['run', '--rm', '--name', 'c', '-v', '/home/ws:/workspace', '-v', '/tmp/edt:/edt-staging', '-w', '/workspace', '--network', 'host', 'vrunner:8.3.27', 'load']
		);
	});

	test('buildDockerCommandSequence: параметры docker.runArgs стоят до точки входа', () => {
		const result = buildDockerCommandSequence('vrunner:8.3.27', [['compile']], '/home/ws', 'sh', { runArgs: ['--network', 'host'] });
		assert.ok(result.includes('-w /workspace --network host --init -e TINI_KILL_PROCESS_GROUP=1 --entrypoint /bin/sh vrunner:8.3.27'), result);
	});

	test('withoutPublishedPorts убирает публикацию портов в любой записи', () => {
		assert.deepStrictEqual(
			withoutPublishedPorts([
				'-p', '127.0.0.1:6080:6080',
				'--network', 'host',
				'--publish', '5900:5900',
				'-p8080:80',
				'--publish=9090:90',
				'-P',
				'--publish-all',
				'--publish-all=true',
				'-e', 'DISPLAY=:0',
				'--pid=host',
			]),
			['--network', 'host', '-e', 'DISPLAY=:0', '--pid=host']
		);
	});

	test('normalizeIbPathForDocker: база внутри проекта становится относительной', () => {
		const root = path.join(os.tmpdir(), 'ws');
		const outside = path.join(os.tmpdir(), 'bases', 'erp');
		assert.strictEqual(normalizeIbPathForDocker(`/F${path.join(root, 'build', 'ib')}`, root), '/F./build/ib');
		assert.strictEqual(normalizeIbPathForDocker('/F./build/ib', root), '/F./build/ib');
		assert.strictEqual(normalizeIbPathForDocker(`/F${outside}`, root), `/F${outside}`);
		assert.strictEqual(normalizeIbPathForDocker(`/F${root}2`, root), `/F${root}2`);
	});
});

