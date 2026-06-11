import * as vscode from 'vscode';

const PROC_START = /^\s*(Процедура|Функция)\s+[А-Яа-яёЁA-Za-z_][А-Яа-яёЁ\w]*\s*\(/i;
const VAR_DECLARE = /^Перем\s/i;

/**
 * Сдвигает строку точки останова (1-based) вниз до ближайшей исполняемой: пустые строки,
 * комментарии, препроцессор (#), директивы (&), «Перем», заголовки процедур и продолжения
 * строковых литералов (|) точку не принимают. Если исполняемой строки ниже нет — исходная.
 */
export function adjustBreakpointLine(lines: string[], line: number): number {
	for (let i = Math.max(0, line - 1); i < lines.length; i++) {
		const t = lines[i].trimStart();
		if (
			t.length === 0 ||
			t.startsWith('//') ||
			t.startsWith('#') ||
			t.startsWith('&') ||
			t.startsWith('|') ||
			VAR_DECLARE.test(t) ||
			PROC_START.test(t)
		) {
			continue;
		}
		return i + 1;
	}
	return line;
}

/**
 * Нормализация точек останова в .bsl при установке: маркер сразу переносится на исполняемую
 * строку — позиции одинаковы и в сессии отладки, и без неё (адаптер делает тот же сдвиг).
 */
export function registerBslBreakpointNormalizer(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.debug.onDidChangeBreakpoints(async (event) => {
			const remove: vscode.Breakpoint[] = [];
			const add: vscode.Breakpoint[] = [];

			for (const bp of event.added) {
				if (!(bp instanceof vscode.SourceBreakpoint)) {
					continue;
				}
				const uri = bp.location.uri;
				if (!uri.fsPath.toLowerCase().endsWith('.bsl')) {
					continue;
				}

				let document: vscode.TextDocument;
				try {
					document = await vscode.workspace.openTextDocument(uri);
				} catch {
					continue;
				}

				const line0 = bp.location.range.start.line;
				const adjusted0 = adjustBreakpointLine(document.getText().split(/\r?\n/), line0 + 1) - 1;
				if (adjusted0 === line0) {
					continue;
				}

				remove.push(bp);
				// На целевой строке уже может стоять точка — тогда просто убираем неисполняемую.
				const occupied = vscode.debug.breakpoints.some(
					(other) =>
						other !== bp &&
						other instanceof vscode.SourceBreakpoint &&
						other.location.uri.toString() === uri.toString() &&
						other.location.range.start.line === adjusted0
				);
				if (!occupied) {
					add.push(
						new vscode.SourceBreakpoint(
							new vscode.Location(uri, new vscode.Position(adjusted0, 0)),
							bp.enabled,
							bp.condition,
							bp.hitCondition,
							bp.logMessage
						)
					);
				}
			}

			if (remove.length > 0) {
				vscode.debug.removeBreakpoints(remove);
				vscode.debug.addBreakpoints(add);
			}
		})
	);
}
