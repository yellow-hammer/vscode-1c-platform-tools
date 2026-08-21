/**
 * Круг экранирования: строка → живая оболочка → те же argv.
 * Запуск: npm run test:shell-argv
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { escapeCommandArgs, PROCESS_HOST_SHELL, quoteExecutable, type ShellType } from '../../utils/shellEscape';

const execFileAsync = promisify(execFile);

/** Аргументы, которые обязаны доехать через любую оболочку. */
const COMMON_FIXTURES: { name: string; args: string[] }[] = [
	{ name: '--additional с пробелами (src/cf)', args: ['designer', '--additional', '/LoadConfigFromFiles src/cf -updateConfigDumpInfo'] },
	{ name: 'литерал $runnerRoot', args: ['--execute', '$runnerRoot/epf/CloseApp.epf'] },
	{ name: 'значение с пробелами', args: ['--settings', 'env.my profile.json'] },
	{ name: 'амперсанд в пути', args: ['--settings', 'C:/Dev&Ops/env.json'] },
	{ name: 'конвейер и перенаправление', args: ['--filter', 'x|y', '--name', 'a>b'] },
	{ name: 'скобки и точка с запятой', args: ['--dir', 'C:/Program Files (x86)/1cv8', '--tag', 'a;b'] },
	{ name: 'обратная кавычка и восклицательный знак', args: ['--name', 'a`b!c!'] },
	{ name: 'кириллица с пробелом', args: ['--settings', 'Рабочая база/env.json'] },
	{ name: 'табуляция внутри значения', args: ['--name', 'a\tb'] },
];

/**
 * Аргументы, которые Windows PowerShell 5.1 не умеет отдавать native-программе:
 * встроенная кавычка теряется, пустая строка выбрасывается. В PowerShell 7 и в
 * оболочках дочернего процесса они доезжают.
 */
const HARD_FIXTURES: { name: string; args: string[] }[] = [
	{ name: 'кавычки внутри значения', args: ['--name', 'say "hi" there'] },
	{ name: 'пустой аргумент', args: ['--name', '', '--tail'] },
];

const TEST_TIMEOUT_MS = 20_000;
const ECHO_ARGV_REL = 'scripts/echo-argv.mjs';
const WIN_EXEC_PREFIX = process.platform === 'win32' ? 'chcp 65001 >nul && ' : '';

function resolveRepoRoot(): string {
	let dir = __dirname;
	for (let i = 0; i < 10; i++) {
		if (existsSync(path.join(dir, 'package.json'))) {
			return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	throw new Error('Не найден корень репозитория при поиске echo-argv');
}

const repoRoot = resolveRepoRoot();

function parseArgvJson(stdout: string, stderr: string): string[] {
	const line = stdout
		.trim()
		.split(/\r?\n/)
		.map((item) => item.trim())
		.filter((item) => item !== '')
		.at(-1);
	if (line === undefined) {
		throw new Error(`пустой stdout, stderr=${JSON.stringify(stderr)}`);
	}
	const parsed: unknown = JSON.parse(line);
	if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
		throw new Error(`ожидали массив строк argv, получили ${line}; stderr=${JSON.stringify(stderr)}`);
	}
	return parsed as string[];
}

function listBinaries(name: string): string[] {
	try {
		const locator = process.platform === 'win32' ? 'where.exe' : 'which';
		const out = execFileSync(locator, [name], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		return out.split(/\r?\n/).map((item) => item.trim()).filter((item) => item !== '');
	} catch {
		return [];
	}
}

function resolveBinary(name: string): string | undefined {
	return listBinaries(name)[0];
}

/** Git Bash, не WSL: System32\\bash.exe не видит Windows-пути node. */
function resolveBash(): string | undefined {
	if (process.platform !== 'win32') {
		return resolveBinary('bash');
	}
	const gitCandidates = [
		path.join(process.env.ProgramFiles ?? String.raw`C:\Program Files`, 'Git', 'bin', 'bash.exe'),
		path.join(process.env['ProgramFiles(x86)'] ?? String.raw`C:\Program Files (x86)`, 'Git', 'bin', 'bash.exe'),
	];
	const fromGit = gitCandidates.find((candidate) => existsSync(candidate));
	if (fromGit !== undefined) {
		return fromGit;
	}
	return listBinaries('bash').find(
		(item) => !/\\System32\\bash\.exe$/i.test(item) && !/\\Sysnative\\bash\.exe$/i.test(item)
	);
}

/** node из PATH и относительный echo-argv: в оболочку не попадает process.execPath. */
function buildLine(args: string[], shell: ShellType): string {
	return ['node', escapeCommandArgs([ECHO_ARGV_REL], shell), escapeCommandArgs(args, shell)].join(' ');
}

async function runShell(
	file: string,
	argv: string[],
	env: NodeJS.ProcessEnv = process.env,
	windowsVerbatimArguments = false
): Promise<string[]> {
	const { stdout, stderr } = await execFileAsync(file, argv, {
		encoding: 'utf8',
		windowsHide: true,
		cwd: repoRoot,
		env,
		windowsVerbatimArguments,
	});
	return parseArgvJson(String(stdout), String(stderr));
}

/** Как child_process.exec: cmd /d /s /c "…" или /bin/sh -c, без интерполяции process.execPath. */
async function runViaHostExec(command: string, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
	if (process.platform === 'win32') {
		return runShell('cmd.exe', ['/d', '/s', '/c', `"${command}"`], env, true);
	}
	return runShell('/bin/sh', ['-c', command], env);
}

async function runViaExec(args: string[]): Promise<string[]> {
	return runViaHostExec(`${WIN_EXEC_PREFIX}${buildLine(args, PROCESS_HOST_SHELL)}`);
}

async function runViaPowerShell(binary: string, args: string[]): Promise<string[]> {
	return runShell(binary, ['-NoProfile', '-NonInteractive', '-Command', `& ${buildLine(args, 'powershell')}`]);
}

async function runViaPosix(binary: string, shell: ShellType, args: string[]): Promise<string[]> {
	const env = process.platform === 'win32' && shell === 'bash'
		? { ...process.env, MSYS_NO_PATHCONV: '1' }
		: process.env;
	return runShell(binary, ['-c', buildLine(args, shell)], env);
}

/**
 * Обёртка формы vrunner.bat (`@call <программа> "<скрипт>" %*`) в каталоге с
 * пробелом, амперсандом и скобками: аргументы проходят второй разбор cmd.
 */
function createBatWrapper(): { batPath: string; env: NodeJS.ProcessEnv } {
	const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'pt-shell-')), 'vrunner & tools (x86)');
	mkdirSync(dir);
	const batPath = path.join(dir, 'echo-argv.bat');
	writeFileSync(batPath, '@call node "%PT_ECHO_ARGV%" %*\r\n@exit /b %ERRORLEVEL%\r\n', 'latin1');
	return { batPath, env: { ...process.env, PT_ECHO_ARGV: path.join(repoRoot, ECHO_ARGV_REL) } };
}

type Probe = {
	name: string;
	run: (args: string[]) => Promise<string[]>;
	/** Оболочка не умеет отдавать native-программе кавычку и пустую строку. */
	skipHard?: boolean;
};

function collectProbes(): Probe[] {
	const probes: Probe[] = [{ name: `exec/${PROCESS_HOST_SHELL}`, run: runViaExec }];

	const powershell = resolveBinary(process.platform === 'win32' ? 'powershell.exe' : 'pwsh');
	if (powershell !== undefined) {
		probes.push({
			name: path.basename(powershell),
			run: (args) => runViaPowerShell(powershell, args),
			skipHard: process.platform === 'win32',
		});
	}

	const pwsh = resolveBinary('pwsh');
	if (pwsh !== undefined && pwsh !== powershell) {
		probes.push({ name: 'pwsh', run: (args) => runViaPowerShell(pwsh, args) });
	}

	const bash = resolveBash();
	if (bash !== undefined) {
		probes.push({ name: 'bash', run: (args) => runViaPosix(bash, 'bash', args) });
	}

	if (process.platform !== 'win32') {
		const sh = resolveBinary('sh');
		if (sh !== undefined) {
			probes.push({ name: 'sh', run: (args) => runViaPosix(sh, 'sh', args) });
		}
	}

	const zsh = resolveBinary('zsh');
	if (zsh !== undefined) {
		probes.push({ name: 'zsh', run: (args) => runViaPosix(zsh, 'zsh', args) });
	}

	if (process.platform === 'win32') {
		const { batPath, env } = createBatWrapper();
		probes.push({
			name: 'exec/cmd → .bat',
			run: (args) => runViaHostExec(
				`${WIN_EXEC_PREFIX}${quoteExecutable(batPath, 'cmd')} ${escapeCommandArgs(args, 'cmd')}`,
				env
			),
		});
	}

	return probes;
}

const probes = collectProbes();

describe(`круг argv на ${process.platform} (${probes.map((probe) => probe.name).join(', ')})`, () => {
	for (const probe of probes) {
		for (const fixture of COMMON_FIXTURES) {
			test(`${probe.name}: ${fixture.name}`, { timeout: TEST_TIMEOUT_MS }, async () => {
				assert.deepEqual(await probe.run(fixture.args), fixture.args);
			});
		}
		for (const fixture of HARD_FIXTURES) {
			test(`${probe.name}: ${fixture.name}`, { timeout: TEST_TIMEOUT_MS, skip: probe.skipHard }, async () => {
				assert.deepEqual(await probe.run(fixture.args), fixture.args);
			});
		}
	}

	test(
		'кавычки PowerShell в exec/cmd режут --additional',
		{ timeout: TEST_TIMEOUT_MS, skip: process.platform !== 'win32' },
		async () => {
			const args = ['designer', '--additional', '/LoadConfigFromFiles src/cf -updateConfigDumpInfo'];
			const received = await runViaHostExec(`${WIN_EXEC_PREFIX}${buildLine(args, 'powershell')}`);
			assert.notDeepEqual(received, args);
		}
	);

	test(
		'процент доезжает до программы, но не через .bat-обёртку',
		{ timeout: TEST_TIMEOUT_MS, skip: process.platform !== 'win32' },
		async () => {
			const args = ['--settings', 'env%PT_SHELL_PROBE%.json'];
			const env = { ...process.env, PT_SHELL_PROBE: 'expanded' };

			assert.deepEqual(
				await runViaHostExec(`${WIN_EXEC_PREFIX}${buildLine(args, 'cmd')}`, env),
				args,
				'до .exe процент должен доехать литералом: каретка гасит раскрытие cmd'
			);

			const { batPath, env: batEnv } = createBatWrapper();
			const viaBat = await runViaHostExec(
				`${WIN_EXEC_PREFIX}${quoteExecutable(batPath, 'cmd')} ${escapeCommandArgs(args, 'cmd')}`,
				{ ...batEnv, PT_SHELL_PROBE: 'expanded' }
			);
			assert.deepEqual(
				viaBat,
				['--settings', 'envexpanded.json'],
				'предел: `%*` внутри .bat раскрывает переменную повторно, на нашем уровне это не чинится'
			);
		}
	);
});
