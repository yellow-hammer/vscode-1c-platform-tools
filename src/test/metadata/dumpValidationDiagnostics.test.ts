import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { DumpValidationDiagnostics, CfDumpFinding } from '../../features/metadata/dumpValidationDiagnostics';

suite('Проверка выгрузки: находки в Problems', () => {
	const cfRoot = path.join(__dirname, 'нет-такого-каталога', 'src', 'cf');

	test('находка без файла на диске садится на состав выгрузки', () => {
		const diagnostics = new DumpValidationDiagnostics();
		const findings: CfDumpFinding[] = [
			{
				path: 'Catalogs/Валюты.xml',
				objectType: 'Catalog',
				objectName: 'Валюты',
				kind: 'missing-file',
				message: 'объект объявлен в составе, файла нет',
			},
		];

		diagnostics.publish(cfRoot, findings);
		const found = vscode.languages.getDiagnostics(
			vscode.Uri.file(path.join(cfRoot, 'Configuration.xml'))
		);

		assert.strictEqual(found.length, 1, 'находка не попала на Configuration.xml');
		assert.strictEqual(found[0].severity, vscode.DiagnosticSeverity.Error);
		assert.strictEqual(found[0].code, 'missing-file');
		diagnostics.dispose();
	});

	test('беспорядок в выгрузке идёт предупреждением, а не ошибкой', () => {
		const diagnostics = new DumpValidationDiagnostics();

		diagnostics.publish(cfRoot, [
			{
				path: 'Roles/Забытая.xml',
				objectType: 'Role',
				objectName: 'Забытая',
				kind: 'orphan-file',
				message: 'файл объекта есть, в составе не объявлен',
			},
		]);
		const found = vscode.languages.getDiagnostics(
			vscode.Uri.file(path.join(cfRoot, 'Configuration.xml'))
		);

		assert.strictEqual(found[0].severity, vscode.DiagnosticSeverity.Warning);
		diagnostics.dispose();
	});

	test('повторная проверка снимает прежние находки этой выгрузки', () => {
		const diagnostics = new DumpValidationDiagnostics();
		diagnostics.publish(cfRoot, [
			{ path: '', objectType: '', objectName: '', kind: 'missing-file', message: 'первая' },
		]);

		diagnostics.publish(cfRoot, []);
		const found = vscode.languages.getDiagnostics(
			vscode.Uri.file(path.join(cfRoot, 'Configuration.xml'))
		);

		assert.strictEqual(found.length, 0, 'старые находки остались висеть');
		diagnostics.dispose();
	});
});
