import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { isVerboseLevel } from '../../shared/logger';

suite('logger.isVerboseLevel', () => {
	test('Off — логирование выключено, не verbose', () => {
		assert.strictEqual(isVerboseLevel(vscode.LogLevel.Off), false);
	});

	test('Trace — самый подробный уровень, verbose', () => {
		assert.strictEqual(isVerboseLevel(vscode.LogLevel.Trace), true);
	});

	test('Debug — verbose', () => {
		assert.strictEqual(isVerboseLevel(vscode.LogLevel.Debug), true);
	});

	test('Info — не verbose', () => {
		assert.strictEqual(isVerboseLevel(vscode.LogLevel.Info), false);
	});

	test('Warning — не verbose', () => {
		assert.strictEqual(isVerboseLevel(vscode.LogLevel.Warning), false);
	});

	test('Error — не verbose', () => {
		assert.strictEqual(isVerboseLevel(vscode.LogLevel.Error), false);
	});
});
