import * as assert from 'node:assert';
import * as path from 'node:path';
import {
	edtStartArgs,
	edtStartFromRegistryOutput,
	findEdtStart,
	iniSetVm,
	iniWithVm,
	javaExecutable,
	jvmOfFeature,
	launcherJava,
	requiredJavaFeature,
	vmFromIni,
	launchEdtStart,
} from '../../features/ibases/edtStart';
import { edtComponentRoots, fileUrlToPath } from '../../shared/edtLocator';

const COMPONENTS = path.join(
	__dirname, '..', '..', '..', 'src', 'test', 'fixtures', 'installations', 'windows', 'ProgramFiles'
);

const URL = 'e1cedt://start/open?projectId=1&projectName=%D0%91%D0%B0%D0%B7%D0%B0&infobaseId=1&platformVersion=8.3';

suite('Запуск 1cedtstart по ссылке базы', () => {
	test('путь стартера читается из команды обработчика схемы в реестре', () => {
		const output =
			'\r\nHKEY_CLASSES_ROOT\\e1cedt\\shell\\open\\command\r\n' +
			'    (Default)    REG_SZ    "C:\\Program Files\\1C\\1CE\\components\\1c-edt-start-0.8.0+429-x86_64\\1cedtstart.exe" "%1"\r\n';
		assert.strictEqual(
			edtStartFromRegistryOutput(output),
			'C:\\Program Files\\1C\\1CE\\components\\1c-edt-start-0.8.0+429-x86_64\\1cedtstart.exe'
		);
		assert.strictEqual(edtStartFromRegistryOutput('ERROR: The system was unable to find the specified registry key'), undefined);
	});

	test('в аргументах -vm это исполняемый файл, каталог из ini дополняется', () => {
		assert.strictEqual(javaExecutable('C:\\Java\\17\\bin', 'win32', false), 'C:\\Java\\17\\bin\\javaw.exe');
		assert.strictEqual(javaExecutable('C:\\Java\\25\\bin', 'win32', true), 'C:\\Java\\25\\bin\\java.exe');
		assert.strictEqual(javaExecutable('C:\\Java\\25\\bin\\java.exe', 'win32', true), 'C:\\Java\\25\\bin\\java.exe');
		const preferences = JSON.stringify({
			jvmInfo: {
				'17': { jvmPath: 'file:///C:/Java/17/bin/' },
				'25': { jvmPath: 'file:///C:/Java/25/bin/' },
			},
		});
		const existing = new Set(['C:\\Java\\17\\bin\\javaw.exe', 'C:\\Java\\25\\bin\\java.exe']);
		const ini = '-vm\nC:\\Java\\17\\bin\n-vmargs\n-Dosgi.requiredJavaVersion=17\n';
		assert.strictEqual(launcherJava(ini, preferences, false, 'win32', (file) => existing.has(file)), 'C:\\Java\\17\\bin\\javaw.exe');
		assert.strictEqual(
			launcherJava('-Dosgi.requiredJavaVersion=25\n', preferences, true, 'win32', (file) => existing.has(file)),
			'C:\\Java\\25\\bin\\java.exe'
		);
		assert.strictEqual(launcherJava('не ini', preferences, true, 'win32', () => true), undefined);
	});

	test('1cedtcli берёт Java нужной версии, консольную', () => {
		const preferences = JSON.stringify({
			jvmInfo: {
				'17': { jvmPath: 'file:///C:/Java/17/bin/' },
				'25': { jvmPath: 'file:///C:/Java/25/bin/' },
			},
		});
		const existing = new Set(['C:\\Java\\17\\bin\\java.exe', 'C:\\Java\\25\\bin\\java.exe', 'C:\\Java\\25\\bin\\javaw.exe']);
		assert.strictEqual(jvmOfFeature(preferences, 25, 'win32', (file) => existing.has(file)), 'C:\\Java\\25\\bin\\java.exe');
		assert.strictEqual(jvmOfFeature(preferences, 21, 'win32', (file) => existing.has(file)), undefined);
		assert.strictEqual(requiredJavaFeature('-Dosgi.requiredJavaVersion=25\n-Xmx4g'), 25);
		assert.strictEqual(requiredJavaFeature('-Xmx4g'), undefined);
		assert.strictEqual(vmFromIni('-vm\nC:\\Java\\17\\bin\n-vmargs\n-Dosgi.requiredJavaVersion=17'), 'C:\\Java\\17\\bin');
		assert.strictEqual(vmFromIni('-vmargs\n-Dosgi.requiredJavaVersion=17'), undefined);
		assert.strictEqual(
			iniWithVm('-vmargs\n-Dosgi.requiredJavaVersion=25\n', 'C:\\Java\\25\\bin'),
			'-vm\nC:\\Java\\25\\bin\n-vmargs\n-Dosgi.requiredJavaVersion=25\n'
		);
		assert.strictEqual(iniWithVm('-vm\nC:\\Java\\17\\bin\n-vmargs\n', 'C:\\Java\\25\\bin'), '-vm\nC:\\Java\\17\\bin\n-vmargs\n');
		assert.strictEqual(
			iniSetVm('-vm\nC:\\Java\\17\\bin\n-vmargs\n-Dosgi.requiredJavaVersion=17\n', 'C:\\Java\\25\\bin'),
			'-vm\nC:\\Java\\25\\bin\n-vmargs\n-Dosgi.requiredJavaVersion=17\n'
		);
	});

	test('ссылка file переводится в путь целевой платформы независимо от хоста', () => {
		assert.strictEqual(fileUrlToPath('file:///C:/Program%20Files/Axiom/bin/', 'win32'), 'C:\\Program Files\\Axiom\\bin\\');
		assert.strictEqual(fileUrlToPath('file:///usr/lib/jvm/bin/', 'linux'), '/usr/lib/jvm/bin/');
		assert.strictEqual(fileUrlToPath('C:\\Java\\bin', 'win32'), 'C:\\Java\\bin');
	});

	test('на Windows JVM и ссылка идут в кавычках, на Linux как есть', () => {
		assert.deepStrictEqual(edtStartArgs(URL, 'C:\\Java\\bin\\javaw.exe', 'win32'), ['-vm', '"C:\\Java\\bin\\javaw.exe"', `"${URL}"`]);
		assert.deepStrictEqual(edtStartArgs(URL, '/usr/lib/jvm/bin/java', 'linux'), ['-vm', '/usr/lib/jvm/bin/java', URL]);
		assert.deepStrictEqual(edtStartArgs(URL, undefined, 'win32'), [`"${URL}"`]);
		assert.deepStrictEqual(edtStartArgs(undefined, 'C:\\Java\\bin\\javaw.exe', 'win32'), ['-vm', '"C:\\Java\\bin\\javaw.exe"']);
	});

	test('запуск передаёт javaw версии из ini, а не старшую из настроек', () => {
		const spawned: { command: string; args: readonly string[] }[] = [];
		const exe = 'C:\\1C\\1CE\\components\\1c-edt-start-0.8.0\\1cedtstart.exe';
		const result = launchEdtStart(URL, {
			platform: 'win32',
			registryQuery: () => `    (Default)    REG_SZ    "${exe}" "%1"`,
			readFile: (file) => file.endsWith('1cedtstart.ini')
				? '-Dosgi.requiredJavaVersion=17\n'
				: JSON.stringify({
					jvmInfo: {
						'17': { jvmPath: 'file:///C:/Java/17/bin/' },
						'25': { jvmPath: 'file:///C:/Java/25/bin/' },
					},
				}),
			exists: (file) => file === exe || file.endsWith('\\javaw.exe'),
			spawn: (command, args) => spawned.push({ command, args }),
		});
		assert.ok(result.ok);
		assert.deepStrictEqual(spawned, [{ command: exe, args: ['-vm', '"C:\\Java\\17\\bin\\javaw.exe"', `"${URL}"`] }]);
	});

	test('каталог -vm из ini стартера передаётся как javaw.exe', () => {
		const spawned: { command: string; args: readonly string[] }[] = [];
		const exe = 'C:\\1C\\1CE\\components\\1c-edt-start-0.8.0\\1cedtstart.exe';
		const result = launchEdtStart(URL, {
			platform: 'win32',
			registryQuery: () => `    (Default)    REG_SZ    "${exe}" "%1"`,
			readFile: (file) => file.endsWith('1cedtstart.ini')
				? '-vm\nC:\\Java\\17\\bin\n-vmargs\n'
				: JSON.stringify({ jvmInfo: { '25': { jvmPath: 'file:///C:/Java/25/bin/' } } }),
			exists: (file) => file === exe || file === 'C:\\Java\\17\\bin\\javaw.exe',
			spawn: (command, args) => spawned.push({ command, args }),
		});
		assert.ok(result.ok);
		assert.deepStrictEqual(spawned, [{ command: exe, args: ['-vm', '"C:\\Java\\17\\bin\\javaw.exe"', `"${URL}"`] }]);
	});

	test('без ссылки стартер открывает своё окно', () => {
		const spawned: { command: string; args: readonly string[] }[] = [];
		const exe = 'C:\\1C\\1CE\\components\\1c-edt-start-0.8.0\\1cedtstart.exe';
		const result = launchEdtStart(undefined, {
			platform: 'win32',
			registryQuery: () => `    (Default)    REG_SZ    "${exe}" "%1"`,
			readFile: () => undefined,
			exists: (file) => file === exe,
			spawn: (command, args) => spawned.push({ command, args }),
		});
		assert.ok(result.ok);
		assert.deepStrictEqual(spawned, [{ command: exe, args: [] }]);
	});

	test('без обработчика схемы стартер находится в каталоге компонентов установщика', () => {
		const roots = edtComponentRoots('win32', { ProgramW6432: COMPONENTS, ProgramFiles: COMPONENTS });
		assert.deepStrictEqual(roots, [path.join(COMPONENTS, '1C', '1CE', 'components')]);
		assert.strictEqual(
			findEdtStart({ platform: 'win32', registryQuery: () => '', componentRoots: roots }),
			path.join(roots[0], '1c-edt-start-0.9.0+213-x86_64', '1cedtstart.exe')
		);
	});

	test('на macOS стартер в каталоге компонентов не ищется', () => {
		const roots = edtComponentRoots('win32', { ProgramW6432: COMPONENTS, ProgramFiles: COMPONENTS });
		assert.strictEqual(findEdtStart({ platform: 'darwin', componentRoots: roots, exists: () => true }), undefined);
		const result = launchEdtStart(URL, {
			platform: 'darwin',
			componentRoots: roots,
			exists: () => true,
			spawn: () => assert.fail('на macOS запускать нечего'),
		});
		assert.ok(!result.ok);
		assert.ok(result.message.includes('macOS'));
	});

	test('без стартера запуск отвечает сообщением, а не падает', () => {
		const result = launchEdtStart(URL, {
			platform: 'win32',
			registryQuery: () => '',
			componentRoots: ['C:\\нет\\такого\\каталога'],
			exists: () => false,
			spawn: () => assert.fail('без стартера запускать нечего'),
		});
		assert.ok(!result.ok);
		assert.ok(result.message.includes('1cedtstart'));
	});
});
