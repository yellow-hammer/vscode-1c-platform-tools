/**
 * Замечания проверки 1С:EDT в панели Problems.
 *
 * Проверка пишет отчёт таблицей, и без разбора он остаётся файлом, который
 * нужно читать глазами. Здесь замечания раскладываются по файлам проекта, как
 * это делает синтаксический контроль: объект метаданных назван по-русски, и
 * путь к модулю считается тем же резолвером.
 *
 * @module edtDiagnostics
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { notifyQuiet } from '../../shared/notify';
import { resolveBslPathFromMetadata } from '../diagnostics/metadataPathResolver';
import { objectFile, typeDirectory } from '../../shared/objectPaths';
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
	switch (finding.severity) {
		case 'error':
			return vscode.DiagnosticSeverity.Error;
		case 'info':
			return vscode.DiagnosticSeverity.Information;
		default:
			return vscode.DiagnosticSeverity.Warning;
	}
}

/**
 * Файл замечания: модуль объекта, а если его нет - описание самого объекта.
 *
 * @param finding - Замечание
 * @param sourceRoot - Каталог исходников проекта
 * @returns Существующий файл или undefined
 */
async function findingFile(finding: EdtValidationFinding, sourceRoot: string): Promise<string | undefined> {
	if (!finding.metadataPath) {
		return undefined;
	}

	const candidates: string[] = [];
	const module = resolveBslPathFromMetadata(finding.metadataPath, 'edt');
	if (module) {
		candidates.push(path.join(sourceRoot, module));
	}
	// Замечание к самому объекту показывается на его описании
	const segments = finding.metadataPath.split('.');
	if (segments.length >= 2 && typeDirectory(segments[0])) {
		const description = objectFile('edt', segments[0], segments[1]);
		if (description) {
			candidates.push(path.join(sourceRoot, description));
		}
	}

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

/** Текст замечания: положение внутри объекта видно только из отчёта. */
function messageOf(finding: EdtValidationFinding): string {
	const where = finding.position ? `${finding.position}: ` : '';
	return `${where}${finding.message}`;
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

	const sourceRoot = path.join(projectPath, 'src');
	const byFile = new Map<string, vscode.Diagnostic[]>();
	const withoutFile: EdtValidationFinding[] = [];

	for (const finding of findings) {
		const file = await findingFile(finding, sourceRoot);
		if (!file) {
			withoutFile.push(finding);
			continue;
		}

		const line = Math.max((finding.line ?? 1) - 1, 0);
		const diagnostic = new vscode.Diagnostic(
			new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
			messageOf(finding),
			severityOf(finding)
		);
		diagnostic.source = '1С:EDT';
		diagnostic.code = finding.check;
		byFile.set(file, [...(byFile.get(file) ?? []), diagnostic]);
	}

	for (const [file, items] of byFile) {
		collected.set(vscode.Uri.file(file), items);
	}

	// Замечания без своего файла показываем на самом проекте: иначе они пропадут
	if (withoutFile.length > 0) {
		collected.set(
			vscode.Uri.file(projectPath),
			withoutFile.map((finding) => {
				const diagnostic = new vscode.Diagnostic(
					new vscode.Range(0, 0, 0, 0),
					finding.metadataPath ? `${finding.metadataPath}: ${messageOf(finding)}` : messageOf(finding),
					severityOf(finding)
				);
				diagnostic.source = '1С:EDT';
				diagnostic.code = finding.check;
				return diagnostic;
			})
		);
	}

	const errors = findings.filter((finding) => finding.severity === 'error').length;
	notifyQuiet(
		errors > 0
			? `Проверка EDT: замечаний ${findings.length}, из них ошибок ${errors}`
			: `Проверка EDT: замечаний ${findings.length}`
	);
}
