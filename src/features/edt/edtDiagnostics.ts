/**
 * Замечания проверки 1С:EDT в панели Problems.
 *
 * Проверка пишет отчёт таблицей, и без разбора он остаётся файлом, который
 * нужно читать глазами. Здесь замечания раскладываются по файлам проекта, как
 * это делает синтаксический контроль.
 *
 * @module edtDiagnostics
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { notifyQuiet } from '../../shared/notify';
import { parseEdtValidationReport, type EdtValidationFinding } from './edtValidateReport';

const log = logger.scope('edt');

let collection: vscode.DiagnosticCollection | undefined;

/** Коллекция замечаний проверки EDT. */
function diagnostics(): vscode.DiagnosticCollection {
	if (!collection) {
		collection = vscode.languages.createDiagnosticCollection('1c-edt-validate');
	}
	return collection;
}

/** Освобождает коллекцию при выключении расширения. */
export function disposeEdtDiagnostics(): void {
	collection?.dispose();
	collection = undefined;
}

/** Уровень замечания в терминах VS Code. */
function severityOf(finding: EdtValidationFinding): vscode.DiagnosticSeverity {
	return finding.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
}

/**
 * Файл замечания: путь в отчёте бывает и от проекта, и от его родителя.
 *
 * @param finding - Замечание
 * @param projectPath - Каталог проекта
 * @returns Существующий файл или undefined
 */
async function findingFile(finding: EdtValidationFinding, projectPath: string): Promise<string | undefined> {
	if (!finding.file) {
		return undefined;
	}
	if (path.isAbsolute(finding.file)) {
		return finding.file;
	}

	const candidates = [
		path.join(projectPath, finding.file),
		path.join(path.dirname(projectPath), finding.file),
	];
	for (const candidate of candidates) {
		try {
			await fs.access(candidate);
			return candidate;
		} catch {
			continue;
		}
	}
	return undefined;
}

/**
 * Показывает замечания проверки в Problems.
 *
 * @param reportPath - Файл отчёта проверки
 * @param projectPath - Каталог проверенного проекта
 */
export async function showValidationFindings(reportPath: string, projectPath: string): Promise<void> {
	let content: string;
	try {
		content = await fs.readFile(reportPath, 'utf-8');
	} catch {
		log.info('Отчёт проверки EDT не найден');
		return;
	}

	const findings = parseEdtValidationReport(content);
	const collected = diagnostics();
	collected.clear();

	if (findings.length === 0) {
		notifyQuiet('Проверка EDT: замечаний нет');
		return;
	}

	const byFile = new Map<string, vscode.Diagnostic[]>();
	const withoutFile: EdtValidationFinding[] = [];

	for (const finding of findings) {
		const file = await findingFile(finding, projectPath);
		if (!file) {
			withoutFile.push(finding);
			continue;
		}

		const line = Math.max((finding.line ?? 1) - 1, 0);
		const diagnostic = new vscode.Diagnostic(
			new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
			finding.message,
			severityOf(finding)
		);
		diagnostic.source = '1С:EDT';
		byFile.set(file, [...(byFile.get(file) ?? []), diagnostic]);
	}

	for (const [file, items] of byFile) {
		collected.set(vscode.Uri.file(file), items);
	}

	// Замечания без файла показываем на самом проекте: иначе они пропадут
	if (withoutFile.length > 0) {
		collected.set(
			vscode.Uri.file(projectPath),
			withoutFile.map((finding) => {
				const diagnostic = new vscode.Diagnostic(
					new vscode.Range(0, 0, 0, 0),
					finding.message,
					severityOf(finding)
				);
				diagnostic.source = '1С:EDT';
				return diagnostic;
			})
		);
	}

	notifyQuiet(`Проверка EDT: замечаний ${findings.length}`);
}
