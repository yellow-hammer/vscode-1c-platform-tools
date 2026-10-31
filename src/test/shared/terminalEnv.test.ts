import * as assert from 'node:assert';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { initTerminalEnv, setTerminalOscriptBinDir } from '../../shared/terminalEnv';

const BIN = path.resolve('/ovm/2.2.1/bin');

/** Повтор после файлов запуска оболочки: на Windows интеграция bash портит пути. */
const AFTER_SHELL = process.platform === 'win32' ? '' : ' после оболочки';

/** Коллекция окружения, которая записывает правки. */
function recordingCollection(): { calls: string[]; collection: vscode.EnvironmentVariableCollection } {
	const calls: string[] = [];
	const after = (options?: vscode.EnvironmentVariableMutatorOptions) => (options?.applyAtShellIntegration === true ? ' после оболочки' : '');
	const collection = {
		description: undefined as string | undefined,
		prepend: (name: string, value: string, options?: vscode.EnvironmentVariableMutatorOptions) => calls.push(`prepend ${name} ${value}${after(options)}`),
		replace: (name: string, value: string, options?: vscode.EnvironmentVariableMutatorOptions) => calls.push(`replace ${name} ${value}${after(options)}`),
		clear: () => calls.push('clear'),
	};
	return { calls, collection: collection as unknown as vscode.EnvironmentVariableCollection };
}

suite('окружение новых терминалов', () => {
	test('движок проекта первым в PATH и в переменных OVM и opm, на Linux и macOS и после файлов запуска оболочки', () => {
		const { calls, collection } = recordingCollection();
		initTerminalEnv(collection);

		setTerminalOscriptBinDir(BIN);

		assert.deepStrictEqual(calls, [
			`prepend PATH ${BIN}${path.delimiter}${AFTER_SHELL}`,
			`replace OVM_OSCRIPTBIN ${BIN}${AFTER_SHELL}`,
			`replace OSCRIPTBIN ${BIN}${AFTER_SHELL}`,
		]);
	});

	test('после перезагрузки окна первый вызов без движка снимает сохранённую правку', () => {
		const { calls, collection } = recordingCollection();
		initTerminalEnv(collection);

		setTerminalOscriptBinDir(undefined);

		assert.deepStrictEqual(calls, ['clear']);
	});

	test('тот же движок второй раз не пишется, без движка правка снимается', () => {
		const { calls, collection } = recordingCollection();
		initTerminalEnv(collection);
		setTerminalOscriptBinDir(BIN);
		calls.length = 0;

		setTerminalOscriptBinDir(BIN);
		setTerminalOscriptBinDir(undefined);

		assert.deepStrictEqual(calls, ['clear']);
	});
});
