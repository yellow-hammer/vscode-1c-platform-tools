import * as assert from 'node:assert';
import {
	applyLinkedCommands,
	readVrunnerLink,
	referencedBuildFiles,
	writeVrunnerLink,
} from '../../features/serviceFiles/vrunnerLink';

suite('ссылка профиля на файл vrunner', () => {
	test('пишется в выбранный профиль и не затирает базу', () => {
		const profile = { vrunner: { ibconnection: '/F./build/ib', settings: 'autumn-properties.local.json' } };
		const next = writeVrunnerLink(profile, 'v3', './tools/vrunner.local.json');
		assert.strictEqual(readVrunnerLink(next, 'v3'), 'tools/vrunner.local.json');
		assert.strictEqual((next.vrunner as { ibconnection: string }).ibconnection, '/F./build/ib');
		assert.strictEqual((next.vrunner as { settings: string }).settings, 'autumn-properties.local.json');
		assert.strictEqual(readVrunnerLink(profile, 'v3'), undefined);
	});

	test('личный файл настроек ссылкой на vrunner не считается', () => {
		assert.strictEqual(readVrunnerLink({ vrunner: { settings: 'autumn-properties.local.json' } }, 'v3'), undefined);
	});

	test('секции команд и строка базы берутся из файла vrunner', () => {
		const merged = applyLinkedCommands(
			{ vrunner: { ibconnection: '/F./build/ib', test: { vanessa: { vanessasettings: './tools/VAParams.json' } } } },
			{ vrunner: { ibconnection: '/F./build/ci', test: { vanessa: { vanessasettings: './tools/VAParams.local.json' } } } },
			'v3'
		);
		const vrunner = merged.vrunner as { ibconnection: string; test: { vanessa: { vanessasettings: string } } };
		assert.strictEqual(vrunner.ibconnection, '/F./build/ci');
		assert.strictEqual(vrunner.test.vanessa.vanessasettings, './tools/VAParams.local.json');
	});

	test('без строки базы в файле vrunner остаётся строка профиля', () => {
		const merged = applyLinkedCommands(
			{ vrunner: { ibconnection: '/F./build/ib' } },
			{ vrunner: { test: { vanessa: { vanessasettings: './tools/VAParams.json' } } } },
			'v3'
		);
		const vrunner = merged.vrunner as { ibconnection: string };
		assert.strictEqual(vrunner.ibconnection, '/F./build/ib');
	});

	test('из файла vrunner читаются пути, на которые он ссылается', () => {
		assert.deepStrictEqual(
			referencedBuildFiles({ vanessa: { '--vanessasettings': './tools/VAParams.json' } }),
			['tools/VAParams.json']
		);
	});
});
