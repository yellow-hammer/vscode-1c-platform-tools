import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/** Находка проверки выгрузки: контракт операции `cf-validate-dump` md-sparrow. */
export interface CfDumpFinding {
	/** Путь относительно корня выгрузки; пустой, если находка не привязана к файлу. */
	path: string;
	/** Тип объекта, например `Catalog`; пустой для находок уровня выгрузки. */
	objectType: string;
	/** Имя объекта; пустое для находок уровня выгрузки. */
	objectName: string;
	/** Вид проблемы: стабильный идентификатор, см. docs/validate-dump.md в md-sparrow. */
	kind: string;
	/** Текст для показа человеку. */
	message: string;
}

/**
 * Виды находок, которые не ломают загрузку, а сообщают о беспорядке в выгрузке.
 *
 * Лишний файл, неизвестный тип, нарушенный порядок и расхождения служебного
 * файла версий платформа переживёт, поэтому это предупреждения. Всё остальное -
 * ошибки: объявленного объекта нет, ссылка ведёт в никуда, версии разъехались.
 */
const WARNING_KINDS = new Set([
	'orphan-file',
	'unknown-type',
	'child-objects-order',
	'dump-info-version',
	'dump-info-extra',
]);

/**
 * Находки проверки выгрузки в панели Problems.
 *
 * Находки раскладываются по файлам, к которым относятся: объявленный без файла
 * объект - на `Configuration.xml` выгрузки, всё остальное - на свой файл.
 * Номеров строк проверка не даёт, поэтому находка ставится в начало файла.
 */
export class DumpValidationDiagnostics implements vscode.Disposable {
	private readonly collection: vscode.DiagnosticCollection;

	constructor() {
		this.collection = vscode.languages.createDiagnosticCollection('1c-dump-validation');
	}

	/**
	 * Заменяет находки одной выгрузки: прежние по этому корню снимаются.
	 *
	 * @param cfRoot Каталог выгрузки
	 * @param findings Находки проверки
	 */
	publish(cfRoot: string, findings: readonly CfDumpFinding[]): void {
		this.clearRoot(cfRoot);

		const byFile = new Map<string, vscode.Diagnostic[]>();
		for (const finding of findings) {
			const relative = finding.path === '' ? 'Configuration.xml' : finding.path;
			const file = path.join(cfRoot, relative);
			const target = existsOrConfiguration(file, cfRoot);
			const diagnostic = new vscode.Diagnostic(
				new vscode.Range(0, 0, 0, 0),
				finding.message,
				WARNING_KINDS.has(finding.kind)
					? vscode.DiagnosticSeverity.Warning
					: vscode.DiagnosticSeverity.Error
			);
			diagnostic.source = 'Проверка выгрузки';
			diagnostic.code = finding.kind;
			const list = byFile.get(target) ?? [];
			list.push(diagnostic);
			byFile.set(target, list);
		}

		for (const [file, diagnostics] of byFile) {
			this.collection.set(vscode.Uri.file(file), diagnostics);
		}
	}

	/** Снимает находки по одной выгрузке. */
	clearRoot(cfRoot: string): void {
		const prefix = path.normalize(cfRoot) + path.sep;
		const stale: vscode.Uri[] = [];
		this.collection.forEach((uri) => {
			if (path.normalize(uri.fsPath).startsWith(prefix)) {
				stale.push(uri);
			}
		});
		for (const uri of stale) {
			this.collection.delete(uri);
		}
	}

	dispose(): void {
		this.collection.dispose();
	}
}

/**
 * Файл находки, если он есть; иначе `Configuration.xml` выгрузки.
 *
 * Находка про пропавший файл указывает на путь, которого на диске нет, - в
 * Problems такой записи не место, поэтому она садится на состав выгрузки.
 */
function existsOrConfiguration(file: string, cfRoot: string): string {
	return fs.existsSync(file) ? file : path.join(cfRoot, 'Configuration.xml');
}
