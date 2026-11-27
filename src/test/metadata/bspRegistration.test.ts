import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { addBspRegistration } from '../../features/metadata/bspRegistration';

suite('регистрация БСП в объектном модуле', () => {
	const cases = [
		{ title: 'создаёт модуль и открывает регистрацию', source: undefined, added: true },
		{ title: 'дописывает код и открывает его объявление', source: '// Функция СведенияОВнешнейОбработке()\n', added: true },
		{ title: 'открывает существующую регистрацию', source: '// Заголовок\nФункция СВЕДЕНИЯОВНЕШНЕЙОБРАБОТКЕ()\nКонецФункции\n', added: false },
	];

	for (const { title, source, added } of cases) {
		test(title, async () => {
			const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bsp-registration-'));
			const modulePath = path.join(root, 'ObjectModule.bsl');
			const window = vscode.window as unknown as {
				showInputBox: () => Thenable<string | undefined>;
				showTextDocument: (document: vscode.TextDocument, options: vscode.TextDocumentShowOptions) => Thenable<void>;
				showInformationMessage: (message: string) => Thenable<string | undefined>;
				setStatusBarMessage: (message: string) => vscode.Disposable;
			};
			const { showInputBox, showTextDocument, showInformationMessage, setStatusBarMessage } = window;
			let opened = 0;
			let prompts = 0;
			try {
				if (source !== undefined) {
					await fs.writeFile(modulePath, '\uFEFF' + source);
				}
				window.showInputBox = async () => {
					prompts++;
					return 'Демо';
				};
				window.showTextDocument = async (document, options) => {
					opened++;
					assert.equal(document.uri.fsPath, modulePath);
					assert.ok(options.selection);
					assert.match(document.lineAt(options.selection.start.line).text, /^Функция СведенияОВнешнейОбработке\(/iu);
				};
				window.showInformationMessage = async (message) => assert.fail(message);
				window.setStatusBarMessage = (message) => assert.fail(message);

				assert.equal(await addBspRegistration(vscode.Uri.file(modulePath), false, 'Демо'), added);
				assert.equal(opened, 1);
				assert.equal(prompts, added ? 1 : 0);
				const written = await fs.readFile(modulePath, 'utf8');
				assert.ok(written.startsWith('\uFEFF' + (source ?? '')));
				if (added) {
					assert.match(written, /ПараметрыРегистрации\.Версия = "1\.0"/);
				} else {
					assert.equal(written, '\uFEFF' + source);
				}
			} finally {
				Object.assign(window, { showInputBox, showTextDocument, showInformationMessage, setStatusBarMessage });
				await fs.rm(root, { recursive: true, force: true });
			}
		});
	}
});
