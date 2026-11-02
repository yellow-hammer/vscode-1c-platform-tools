/**
 * Версии движка OneScript, установки OVM и выбор установки по ВерсияСреды.
 * Запуск: npm run test:node
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	compareEngineVersions,
	engineVersionSupported,
	listOvmInstallations,
	machineEngineFits,
	parseEngineVersion,
	pickEngineFor,
} from '../../shared/oneScriptEngine';
import { engineFileKey, getOvmBaseDir, getOvmCurrentTarget } from '../../shared/ovmPaths';

describe('версия движка', () => {
	test('из вывода движков 2.x и 1.x, из ВерсияСреды и имени каталога', () => {
		assert.deepEqual(parseEngineVersion('2.2.1\r\n'), { parts: [2, 2, 1], text: '2.2.1' });
		assert.deepEqual(parseEngineVersion('1.0.19.105'), { parts: [1, 0, 19], text: '1.0.19.105' });
		assert.deepEqual(parseEngineVersion('2.0.0-rc.10'), { parts: [2, 0, 0], text: '2.0.0-rc.10' });
		assert.deepEqual(parseEngineVersion('1.4'), { parts: [1, 4, 0], text: '1.4' });
		assert.equal(parseEngineVersion('stable'), undefined);
	});

	test('сравнение по числам', () => {
		assert.ok(compareEngineVersions([2, 2, 1], [2, 2, 0]) > 0);
		assert.ok(compareEngineVersions([1, 9, 2], [2, 0, 0]) < 0);
		assert.equal(compareEngineVersions([2, 0], [2, 0, 0]), 0);
		assert.equal(engineVersionSupported([2, 2, 1], [2, 2, 0]), true);
		assert.equal(engineVersionSupported([1, 9, 2], [2, 0, 0]), false);
	});

	test('движок машины не ниже ВерсияСреды остаётся, ниже — заменяется', () => {
		const engine = (text: string) => parseEngineVersion(text);

		assert.equal(machineEngineFits(engine('2.2.1'), '2.0.0'), true, 'ovm use 2.2.1 при ВерсияСреды 2.0.0');
		assert.equal(machineEngineFits(engine('2.0.0'), '2.0.0'), true);
		assert.equal(machineEngineFits(engine('2.2.1'), '1.9.2'), true, 'opm сравнивает только числа');
		assert.equal(machineEngineFits(engine('2.0.0'), '1.0.20'), true, 'ВерсияСреды vanessa-add');
		assert.equal(machineEngineFits(engine('1.9.2'), '2.0.0'), false);
		assert.equal(machineEngineFits(engine('2.0.0'), undefined), true, 'без ВерсияСреды проверять нечего');
		assert.equal(machineEngineFits(undefined, '2.0.0'), true, 'версия движка неизвестна');
		assert.equal(machineEngineFits(engine('1.9.2'), 'stable'), true, 'ВерсияСреды не номер');
	});
});

describe('установки OVM', () => {
	let base: string;
	const binary = process.platform === 'win32' ? 'oscript.exe' : 'oscript';
	const install = (name: string) => {
		fs.mkdirSync(path.join(base, name, 'bin'), { recursive: true });
		fs.writeFileSync(path.join(base, name, 'bin', binary), '');
	};

	before(() => {
		base = fs.mkdtempSync(path.join(os.tmpdir(), 'ovm-'));
		for (const name of ['1.9.2', '2.0.0', '2.2.1', 'stable']) {
			install(name);
		}
		// current указывает на одну из установок и сам установкой не считается
		install('current');
		fs.mkdirSync(path.join(base, 'не-установка'));
		fs.writeFileSync(path.join(base, 'autumn-properties.ini'), '');
	});

	after(() => {
		fs.rmSync(base, { recursive: true, force: true });
	});

	test('версии рядом, current и каталоги без движка не в счёт', () => {
		const found = listOvmInstallations(base);

		assert.deepEqual(found.map((item) => item.name), ['1.9.2', '2.0.0', '2.2.1', 'stable']);
		assert.equal(found[2].oscript, path.join(base, '2.2.1', 'bin', binary));
		assert.deepEqual(found[2].version?.parts, [2, 2, 1]);
		assert.equal(found[3].version, undefined, 'у метки версии по имени нет');
	});

	test('ВерсияСреды: сначала установка этой версии', () => {
		assert.equal(pickEngineFor('2.0.0', listOvmInstallations(base))?.name, '2.0.0');
		assert.equal(pickEngineFor('stable', listOvmInstallations(base))?.name, 'stable');
	});

	test('ВерсияСреды без своей установки: самая новая той же старшей версии не ниже', () => {
		const found = listOvmInstallations(base);

		assert.equal(pickEngineFor('2.1.0', found)?.name, '2.2.1');
		assert.equal(pickEngineFor('1.8.3', found)?.name, '1.9.2', '1.x не уходит на 2.x');
		assert.equal(pickEngineFor('2.3.0', found), undefined, 'ниже требуемой не берётся');
		assert.equal(pickEngineFor('3.0.0', found), undefined);
	});

	test('нет каталога OVM: установок нет', () => {
		assert.deepEqual(listOvmInstallations(path.join(base, 'нет')), []);
	});

	test('каталог OVM из OVM_INSTALL_PATH, как у самого OVM', () => {
		assert.equal(getOvmBaseDir({ OVM_INSTALL_PATH: base }), base);
		assert.notEqual(getOvmBaseDir({}), base);
	});
});

describe('current OVM', () => {
	let base: string;
	let saved: string | undefined;
	const binary = process.platform === 'win32' ? 'oscript.exe' : 'oscript';

	before(() => {
		base = fs.mkdtempSync(path.join(os.tmpdir(), 'ovm-current-'));
		for (const name of ['2.0.0', '2.2.1']) {
			fs.mkdirSync(path.join(base, name, 'bin'), { recursive: true });
			fs.writeFileSync(path.join(base, name, 'bin', binary), '');
		}
		saved = process.env.OVM_INSTALL_PATH;
		process.env.OVM_INSTALL_PATH = base;
	});

	after(() => {
		if (saved === undefined) {
			delete process.env.OVM_INSTALL_PATH;
		} else {
			process.env.OVM_INSTALL_PATH = saved;
		}
		fs.rmSync(base, { recursive: true, force: true });
	});

	test('после ovm use у current другая цель, движок из current раскрывается в каталог версии', () => {
		const link = path.join(base, 'current');
		const real = (name: string) => fs.realpathSync(path.join(base, name));
		assert.equal(getOvmCurrentTarget(), '', 'без current цели нет');

		fs.symlinkSync(path.join(base, '2.2.1'), link, 'junction');
		assert.equal(getOvmCurrentTarget(), real('2.2.1'));
		assert.equal(engineFileKey(path.join(link, 'bin', binary)), path.join(real('2.2.1'), 'bin', binary));

		fs.rmSync(link);
		fs.symlinkSync(path.join(base, '2.0.0'), link, 'junction');
		assert.equal(getOvmCurrentTarget(), real('2.0.0'), 'ovm use 2.0.0');
		assert.equal(engineFileKey(path.join(link, 'bin', binary)), path.join(real('2.0.0'), 'bin', binary));
		assert.equal(engineFileKey('oscript'), 'oscript', 'имя для PATH как есть');
	});
});
