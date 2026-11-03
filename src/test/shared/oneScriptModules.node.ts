/**
 * Программа пакета: локальный bin, иначе PATH.
 * Запуск: npm run test:node
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { packageProgram } from '../../shared/oneScriptModules';

const fileName = process.platform === 'win32' ? 'depos.bat' : 'depos';

function writeProgram(dir: string): string {
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, fileName);
	fs.writeFileSync(file, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n');
	if (process.platform !== 'win32') {
		fs.chmodSync(file, 0o755);
	}
	return file;
}

describe('packageProgram', () => {
	test('локальная программа важнее PATH', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-local-'));
		const system = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-path-'));
		try {
			const local = writeProgram(path.join(root, 'oscript_modules', 'bin'));
			writeProgram(system);
			assert.equal(packageProgram(root, 'depos', { PATH: system, PATHEXT: '.BAT;.CMD;.EXE' }), local);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
			fs.rmSync(system, { recursive: true, force: true });
		}
	});

	test('без локальной берётся программа из PATH', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-empty-'));
		const system = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-path-'));
		try {
			const found = writeProgram(system);
			assert.equal(packageProgram(root, 'depos', { PATH: system, PATHEXT: '.BAT;.CMD;.EXE' }), found);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
			fs.rmSync(system, { recursive: true, force: true });
		}
	});

	test('программы нет ни в проекте, ни в PATH', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-none-'));
		try {
			assert.equal(packageProgram(root, 'depos', { PATH: root, PATHEXT: '.BAT;.CMD;.EXE' }), undefined);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
