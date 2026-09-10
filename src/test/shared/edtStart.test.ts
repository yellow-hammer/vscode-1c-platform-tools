import * as assert from 'node:assert';
import {
	edtStartArgs,
	edtStartFromRegistryOutput,
	fileUrlToPath,
	jvmFromPreferences,
	launchEdtStart,
} from '../../features/ibases/edtStart';

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

	test('JVM берётся из настроек стартера, старшая версия, только существующая', () => {
		const preferences = JSON.stringify({
			jvmInfo: {
				'17': { jvmPath: 'file:///C:/Program%20Files/Axiom/AxiomJDK-Pro-17-Full/bin/', jvmVersion: { featureVersion: 17 } },
				'21': { jvmPath: 'file:///C:/Java/21/bin/', jvmVersion: { featureVersion: 21 } },
			},
		});
		const existing = new Set(['C:\\Program Files\\Axiom\\AxiomJDK-Pro-17-Full\\bin\\javaw.exe', 'C:\\Java\\21\\bin\\javaw.exe']);
		assert.strictEqual(jvmFromPreferences(preferences, 'win32', (file) => existing.has(file)), 'C:\\Java\\21\\bin\\javaw.exe');
		assert.strictEqual(
			jvmFromPreferences(preferences, 'win32', (file) => file.includes('Axiom')),
			'C:\\Program Files\\Axiom\\AxiomJDK-Pro-17-Full\\bin\\javaw.exe'
		);
		assert.strictEqual(jvmFromPreferences('{}', 'win32', () => true), undefined);
		assert.strictEqual(jvmFromPreferences('не json', 'win32', () => true), undefined);
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

	test('запуск берёт стартер из реестра и его JVM из настроек', () => {
		const spawned: { command: string; args: readonly string[] }[] = [];
		const exe = 'C:\\1C\\1CE\\components\\1c-edt-start-0.8.0\\1cedtstart.exe';
		const result = launchEdtStart(URL, {
			platform: 'win32',
			registryQuery: () => `    (Default)    REG_SZ    "${exe}" "%1"`,
			readFile: () => JSON.stringify({ jvmInfo: { '17': { jvmPath: 'file:///C:/Java/17/bin/' } } }),
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
