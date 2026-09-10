import * as assert from 'node:assert';
import { parseSettingsJson } from '../../shared/settingsJson';

suite('settingsJson: разбор файлов настроек', () => {
	test('BOM, комментарии и висячая запятая не мешают', () => {
		const text = '﻿{\n\t// профиль\n\t"vrunner": { "ibconnection": "/F./build/ib", },\n}\n';
		assert.deepStrictEqual(parseSettingsJson(text), { vrunner: { ibconnection: '/F./build/ib' } });
	});

	test('обычный JSON разбирается как есть', () => {
		assert.deepStrictEqual(parseSettingsJson('{"default": {"--v8version": "8.3"}}'), {
			default: { '--v8version': '8.3' },
		});
	});

	test('ошибка называет причину и строку', () => {
		assert.throws(() => parseSettingsJson('{\n\t"vrunner": {\n\t\t"ibconnection": "/F./build/ib"\n'), /строка 4/);
		assert.throws(() => parseSettingsJson('{ "a": }'), /ожидалось значение, строка 1/);
	});
});
