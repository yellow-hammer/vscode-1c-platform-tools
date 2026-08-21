/**
 * Подстановка каталога установки OneScript в PATH дочернего процесса.
 * Запуск: npm run test:node
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { withBinDirFirst } from '../../shared/ovmPaths';

const OVM_BIN = path.join('C:', 'Users', 'user', 'AppData', 'Local', 'ovm', 'current', 'bin');
const SYSTEM_BIN = path.join('C:', 'Program Files', 'OneScript', 'bin');

describe('withBinDirFirst', () => {
	test('каталог встаёт перед прежним PATH', () => {
		const env = withBinDirFirst({ PATH: `${SYSTEM_BIN}${path.delimiter}C:\\Windows` }, OVM_BIN);
		assert.equal(env.PATH, `${OVM_BIN}${path.delimiter}${SYSTEM_BIN}${path.delimiter}C:\\Windows`);
	});

	test('на Windows переменная называется Path: регистр не теряется', () => {
		const env = withBinDirFirst({ Path: SYSTEM_BIN }, OVM_BIN);
		assert.equal(env.Path, `${OVM_BIN}${path.delimiter}${SYSTEM_BIN}`);
		assert.equal(env.PATH, undefined, 'второй переменной появиться не должно');
	});

	test('без PATH в окружении переменная заводится', () => {
		assert.equal(withBinDirFirst({}, OVM_BIN).PATH, OVM_BIN);
	});

	test('пустой каталог окружение не меняет', () => {
		const source = { Path: SYSTEM_BIN };
		assert.deepEqual(withBinDirFirst(source, undefined), source);
		assert.deepEqual(withBinDirFirst(source, ''), source);
	});

	test('исходное окружение не меняется', () => {
		const source = { Path: SYSTEM_BIN };
		withBinDirFirst(source, OVM_BIN);
		assert.equal(source.Path, SYSTEM_BIN);
	});

	test('остальные переменные сохраняются', () => {
		const env = withBinDirFirst({ Path: SYSTEM_BIN, OVM_OSCRIPTBIN: OVM_BIN }, OVM_BIN);
		assert.equal(env.OVM_OSCRIPTBIN, OVM_BIN);
	});
});
