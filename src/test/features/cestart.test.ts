import * as assert from 'node:assert';
import * as path from 'node:path';
import {
	cestartArgs,
	cestartCandidates,
	cestartFileName,
	findCestart,
	launchInfobase,
	missingFileInfobase,
	shouldPassIbName,
	windowsStartInvocation,
} from '../../features/ibases/cestart';

suite('1cestart', () => {
	test('имя файла зависит от ОС', () => {
		assert.strictEqual(cestartFileName('win32'), '1cestart.exe');
		assert.strictEqual(cestartFileName('linux'), '1cestart');
		assert.strictEqual(cestartFileName('darwin'), '1cestart');
	});

	test('аргументы: ключи 1С слитно, имя в кавычках', () => {
		assert.deepStrictEqual(cestartArgs('ENTERPRISE', 'Информационная база'), [
			'ENTERPRISE',
			'/IBName"Информационная база"',
			'/AppAutoCheckVersion',
		]);
		assert.deepStrictEqual(cestartArgs('DESIGNER', 'Рабочая', { connect: 'Srvr="srv-1c:1541";Ref="erp";' }), [
			'DESIGNER',
			'/IBName"Рабочая"',
			'/S"srv-1c:1541\\erp"',
			'/AppAutoCheckVersion',
		]);
	});

	test('имя с пробелом идёт в /IBName, одноимённые и со слешем — нет', () => {
		assert.strictEqual(shouldPassIbName('Информационная база', ['Информационная база', 'Другая']), true);
		assert.strictEqual(shouldPassIbName('Демо', ['Демо', 'Демо']), false);
		assert.strictEqual(shouldPassIbName('srv/ib', ['srv/ib']), false);
	});

	test('одноимённые базы открываются по строке подключения, без /IBName', () => {
		assert.deepStrictEqual(
			cestartArgs('ENTERPRISE', 'Информационная база', {
				connect: 'File="C:\\bases\\demo";',
				useIbName: false,
			}),
			['ENTERPRISE', '/F"C:\\bases\\demo"', '/AppAutoCheckVersion']
		);
	});

	test('ищет стартер в common рядом с версиями', () => {
		const root = path.join('/opt', '1cv8', 'x86_64');
		const binary = path.join(root, 'common', '1cestart');
		const lookup = findCestart({
			platform: 'linux',
			defaultRoots: [root],
			extraRoots: [],
			exists: (filePath) => filePath === binary,
		});

		assert.strictEqual(lookup.binary, binary);
		assert.deepStrictEqual(lookup.bases, [root]);
	});

	test('если указали каталог версии, поднимается к common', () => {
		const install = path.join('C:', 'Program Files', '1cv8');
		const version = path.join(install, '8.3.27.1936');
		const binary = path.join(install, 'common', '1cestart.exe');
		const lookup = findCestart({
			platform: 'win32',
			defaultRoots: [],
			extraRoots: [version],
			exists: (filePath) => filePath === binary,
		});

		assert.strictEqual(lookup.binary, binary);
		assert.ok(cestartCandidates(version, '1cestart.exe').includes(binary));
	});

	test('запуск передаёт имя базы и не вызывает процесс, если стартера нет', () => {
		const spawned: Array<{ command: string; args: readonly string[] }> = [];
		const missing = launchInfobase('Демо', 'ENTERPRISE', {
			find: () => ({ bases: ['/opt/1cv8'] }),
			spawn: (command, args) => {
				spawned.push({ command, args });
			},
		});
		assert.strictEqual(missing.ok, false);
		assert.deepStrictEqual(spawned, []);

		const started = launchInfobase('Демо', 'DESIGNER', {
			find: () => ({ binary: '/opt/1cv8/common/1cestart', bases: ['/opt/1cv8'] }),
			spawn: (command, args) => {
				spawned.push({ command, args });
			},
		});
		assert.deepStrictEqual(started, {
			ok: true,
			binary: '/opt/1cv8/common/1cestart',
			args: ['DESIGNER', '/IBName"Демо"', '/AppAutoCheckVersion'],
		});
		assert.deepStrictEqual(spawned, [
			{
				command: '/opt/1cv8/common/1cestart',
				args: ['DESIGNER', '/IBName"Демо"', '/AppAutoCheckVersion'],
			},
		]);
	});

	test('на Windows start получает кавычки вокруг exe и ключи 1С как есть', () => {
		const exe = 'C:\\Program Files\\1cv8\\common\\1cestart.exe';
		const invocation = windowsStartInvocation(exe, ['ENTERPRISE', '/F"C:\\bases\\demo"']);
		assert.deepStrictEqual(invocation.args, [
			'/c',
			'start',
			'""',
			'"C:\\Program Files\\1cv8\\common\\1cestart.exe"',
			'ENTERPRISE',
			'/F"C:\\bases\\demo"',
		]);
	});

	test('нет каталога файловой базы — не запускаем стартер', () => {
		const spawned: string[] = [];
		const result = launchInfobase('Демо', 'ENTERPRISE', {
			find: () => ({ binary: 'C:\\1cestart.exe', bases: [] }),
			connect: 'File="C:\\нет-такой-базы";',
			exists: () => false,
			spawn: (command) => {
				spawned.push(command);
			},
		});
		assert.strictEqual(result.ok, false);
		if (!result.ok) {
			assert.match(result.message, /не найден/i);
		}
		assert.deepStrictEqual(spawned, []);
		assert.strictEqual(missingFileInfobase('File="C:\\x";', () => false), 'C:\\x');
	});

	test('пустое имя не запускает клиент', () => {
		assert.deepStrictEqual(launchInfobase('  ', 'ENTERPRISE', { find: () => ({ binary: 'x', bases: [] }) }), {
			ok: false,
			message: 'Не выбрана информационная база.',
		});
	});
});
