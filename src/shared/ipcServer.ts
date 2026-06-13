import * as net from 'node:net';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { logger } from './logger';
import type { VRunnerExecutionResult } from './vrunnerManager';
import type { CommandExecutionOptions, StructuredCommandResult } from './commandExecutionTypes';

const log = logger.scope('ipc');

interface IpcRequest {
	id: unknown;
	method: unknown;
	params?: unknown;
	token?: unknown;
}

interface IpcExecuteCommandParams {
	commandId?: unknown;
	args?: unknown;
	projectPath?: unknown;
}

interface IpcResponse {
	id: string | null;
	result?: unknown;
	error?: {
		message: string;
		code?: string;
		details?: unknown;
	};
}

interface IpcServerConfig {
	enabled: boolean;
	host: string;
	port: number;
	token: string | null;
}

/**
 * Расширенный StructuredCommandResult с метаданными выполнения, которые
 * добавляет ipcServer (длительность, временные метки). Сама команда возвращает
 * базовый StructuredCommandResult; ipcServer добавляет durationMs и временные метки.
 */
interface StructuredCommandResultWithTiming extends StructuredCommandResult {
	startedAt: string;
	finishedAt: string;
	durationMs: number;
}

function readConfig(): IpcServerConfig {
	const config = vscode.workspace.getConfiguration('1c-platform-tools');
	const enabled = config.get<boolean>('ipc.enabled', false);
	const port = config.get<number>('ipc.port', 40241);
	const token = config.get<string>('ipc.token') ?? '';

	return {
		enabled,
		host: '127.0.0.1',
		port: Number.isFinite(port) ? port : 40241,
		token: token === '' ? null : token,
	};
}

function buildResponseBase(id: unknown): Pick<IpcResponse, 'id'> {
	return {
		id: typeof id === 'string' || typeof id === 'number' ? String(id) : null,
	};
}

/**
 * Проверяет, что путь проекта совпадает с одной из папок workspace или находится внутри неё.
 * На Windows сравнение без учёта регистра.
 */
function isProjectPathInWorkspace(
	expectedProjectPath: string,
	workspaceFolders: readonly vscode.WorkspaceFolder[]
): boolean {
	if (workspaceFolders.length === 0) {
		return true;
	}
	const sep = path.sep;
	const norm = (s: string) => (sep === '\\' ? s.toLowerCase() : s);
	const sameOrUnder = (a: string, b: string): boolean => {
		const aNorm = norm(a);
		const bNorm = norm(b);
		return (
			aNorm === bNorm ||
			aNorm.startsWith(norm(b + sep)) ||
			bNorm.startsWith(norm(a + sep))
		);
	};
	const firstRoot = path.resolve(workspaceFolders[0].uri.fsPath);
	const expectedNorm = path.isAbsolute(expectedProjectPath)
		? path.resolve(expectedProjectPath)
		: path.resolve(firstRoot, expectedProjectPath);
	return workspaceFolders.some((folder) => {
		const workspaceNorm = path.resolve(folder.uri.fsPath);
		return sameOrUnder(expectedNorm, workspaceNorm);
	});
}

/**
 * Извлекает флаги IPC из первого элемента массива args.
 * Если первый элемент является объектом с полями-флагами, возвращает их.
 * Иначе возвращает пустой объект.
 *
 * @param args — массив аргументов команды
 * @returns объект с флагами выполнения
 */
function extractCommandFlags(args: unknown[]): CommandExecutionOptions {
	if (args.length === 0) {
		return {};
	}
	const first = args[0];
	if (typeof first === 'object' && first !== null && !Array.isArray(first)) {
		return first as CommandExecutionOptions;
	}
	return {};
}

/**
 * Определяет, поддерживает ли команда синхронный режим выполнения.
 * UI-команды (открытие окон, навигация, просмотр) не поддерживают wait.
 *
 * @param commandId — идентификатор команды расширения
 * @returns true, если команда может выполняться синхронно
 */
function commandSupportsWait(commandId: string): boolean {
	const uiOnlyPrefixes = [
		'1c-platform-tools.run.',
		'1c-platform-tools.file.',
		'1c-platform-tools.metadata.',
		'1c-platform-tools.projects.',
		'1c-platform-tools.todo.',
		'1c-platform-tools.settings.',
		'1c-platform-tools.focus',
		'1c-platform-tools.artifacts.open',
		'1c-platform-tools.artifacts.delete',
	];
	return !uiOnlyPrefixes.some((prefix) => commandId.startsWith(prefix));
}

async function handlePing(
	request: IpcRequest,
	extensionId: string
): Promise<IpcResponse> {
	const base = buildResponseBase(request.id);
	const extension = vscode.extensions.getExtension(extensionId);

	return {
		...base,
		result: {
			ok: true,
			extensionId,
			extensionVersion: extension?.packageJSON.version ?? 'unknown',
		},
	};
}

/**
 * Выполняет команду синхронно через vscode.commands.executeCommand с флагом wait.
 *
 * Команда должна принимать аргумент CommandExecutionOptions и возвращать
 * StructuredCommandResult (или VRunnerExecutionResult — для обратной совместимости).
 * Если команда возвращает undefined (не реализовала sync-режим), возвращает понятное
 * сообщение агенту вместо тихого «Выполнено.».
 *
 * @param request — исходный IPC-запрос
 * @param commandId — идентификатор команды
 * @param projectPath — путь к корню проекта
 * @param flags — флаги выполнения (wait, settingsFile, ibConnection, pathsOverride)
 * @returns IPC-ответ со структурированным commandResult
 */
async function handleExecuteCommandSync(
	request: IpcRequest,
	commandId: string,
	projectPath: string | undefined,
	flags: CommandExecutionOptions
): Promise<IpcResponse> {
	const base = buildResponseBase(request.id);
	const startedAt = new Date().toISOString();
	const startMs = Date.now();

	try {
		const optsForCommand: CommandExecutionOptions = {
			wait: true,
			projectPath,
			settingsFile: flags.settingsFile,
			ibConnection: flags.ibConnection,
			pathsOverride: flags.pathsOverride,
		};
		const rawResult = await vscode.commands.executeCommand(commandId, optsForCommand);

		const finishedAt = new Date().toISOString();
		const durationMs = Date.now() - startMs;

		if (rawResult === undefined || rawResult === null) {
			log.warn(
				`sync: команда ${commandId} вернула undefined при wait: true — ` +
				'синхронный режим не реализован'
			);
			const fallback: StructuredCommandResultWithTiming = {
				success: false,
				exitCode: -1,
				stdout: '',
				stderr:
					`Команда ${commandId} не поддерживает wait: true. ` +
					'Используйте wait: false или реализуйте синхронный режим в команде.',
				startedAt,
				finishedAt,
				durationMs,
			};
			return {
				...base,
				result: { ok: true, commandResult: fallback },
			};
		}

		// Команда может вернуть StructuredCommandResult (новый формат) или VRunnerExecutionResult.
		// Оба формата имеют поля success, exitCode, stdout, stderr.
		const r = rawResult as VRunnerExecutionResult & Partial<StructuredCommandResult>;
		const structured: StructuredCommandResultWithTiming = {
			success: r.success,
			exitCode: typeof r.exitCode === 'number' ? r.exitCode : r.success ? 0 : 1,
			stdout: r.stdout ?? '',
			stderr: r.stderr ?? '',
			artifact: r.artifact,
			startedAt,
			finishedAt,
			durationMs,
		};

		return {
			...base,
			result: { ok: true, commandResult: structured },
		};
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: 'Неизвестная ошибка при синхронном выполнении команды';
		log.error(`sync: ошибка ${commandId}: ${message}`);

		return {
			...base,
			error: { message, code: 'COMMAND_ERROR' },
		};
	}
}

async function handleExecuteCommand(
	request: IpcRequest,
	params: IpcExecuteCommandParams
): Promise<IpcResponse> {
	const base = buildResponseBase(request.id);

	if (typeof params.commandId !== 'string' || params.commandId.trim() === '') {
		return {
			...base,
			error: {
				message: 'Поле params.commandId должно быть непустой строкой',
				code: 'INVALID_COMMAND_ID',
			},
		};
	}

	const args = Array.isArray(params.args) ? params.args : [];
	const flags = extractCommandFlags(args);

	const expectedProjectPath =
		typeof params.projectPath === 'string' && params.projectPath.trim() !== ''
			? params.projectPath
			: undefined;

	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

	if (
		expectedProjectPath &&
		workspaceFolders.length > 0 &&
		!isProjectPathInWorkspace(expectedProjectPath, workspaceFolders)
	) {
		return {
			...base,
			error: {
				message:
					'Путь projectPath не совпадает с текущей рабочей областью VS Code',
				code: 'WORKSPACE_MISMATCH',
				details: {
					projectPath: expectedProjectPath,
					workspaceRoots: workspaceFolders.map((f) => f.uri.fsPath),
				},
			},
		};
	}

	// Синхронный режим: wait: true и команда его поддерживает
	if (flags.wait === true && commandSupportsWait(params.commandId)) {
		return handleExecuteCommandSync(request, params.commandId, expectedProjectPath, flags);
	}

	// Стандартный режим: запуск в UI-терминале
	try {
		const commandResult = await vscode.commands.executeCommand(
			params.commandId,
			...args
		);

		return {
			...base,
			result: {
				ok: true,
				commandResult,
			},
		};
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Неизвестная ошибка при выполнении команды';
		log.error(
			`ошибка при выполнении команды ${String(params.commandId)}: ${message}`
		);

		return {
			...base,
			error: {
				message,
				code: 'COMMAND_ERROR',
			},
		};
	}
}

async function handleListCommands(request: IpcRequest): Promise<IpcResponse> {
	const base = buildResponseBase(request.id);
	const all = await vscode.commands.getCommands();
	const commands = all.filter((id) => id.startsWith('1c-platform-tools.'));
	return {
		...base,
		result: { commands },
	};
}

function createResponseForError(id: unknown, error: unknown): IpcResponse {
	const base = buildResponseBase(id);
	if (error instanceof Error) {
		return {
			...base,
			error: {
				message: error.message,
			},
		};
	}

	return {
		...base,
		error: {
			message: 'Внутренняя ошибка IPC-сервера',
		},
	};
}

function createServer(config: IpcServerConfig, extensionId: string): net.Server {
	return net.createServer((socket) => {
		log.debug('новое соединение');

		let buffer = '';

		const writeResponse = (response: IpcResponse): void => {
			try {
				const payload = `${JSON.stringify(response)}\n`;
				socket.write(payload);
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: 'Неизвестная ошибка при сериализации ответа';
				log.error(`ошибка при отправке ответа: ${message}`);
			}
		};

		socket.on('data', (data: Buffer) => {
			buffer += data.toString('utf8');
			let index = buffer.indexOf('\n');

			while (index !== -1) {
				const line = buffer.slice(0, index).trim();
				buffer = buffer.slice(index + 1);

				if (line !== '') {
					let request: IpcRequest;
					try {
						request = JSON.parse(line) as IpcRequest;
					} catch {
						writeResponse({
							...buildResponseBase(null),
							error: {
								message: 'Некорректный JSON',
								code: 'PARSE_ERROR',
							},
						});
						continue;
					}

					void (async () => {
						const method = request.method;

						if (config.token) {
							if (typeof request.token !== 'string') {
								writeResponse({
									...buildResponseBase(request.id),
									error: {
										message: 'Отсутствует токен аутентификации',
										code: 'UNAUTHORIZED',
									},
								});
								return;
							}

							const expected = Buffer.from(config.token, 'utf8');
							const actual = Buffer.from(request.token, 'utf8');
							if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
								writeResponse({
									...buildResponseBase(request.id),
									error: {
										message: 'Неверный токен аутентификации',
										code: 'UNAUTHORIZED',
									},
								});
								return;
							}
						}

						try {
							if (method === 'ping') {
								const response = await handlePing(request, extensionId);
								writeResponse(response);
							} else if (method === 'executeCommand') {
								const response = await handleExecuteCommand(
									request,
									(request.params ?? {}) as IpcExecuteCommandParams
								);
								writeResponse(response);
							} else if (method === 'listCommands') {
								const response = await handleListCommands(request);
								writeResponse(response);
							} else {
								writeResponse({
									...buildResponseBase(request.id),
									error: {
										message: 'Неизвестный метод',
										code: 'UNKNOWN_METHOD',
										details: { method },
									},
								});
							}
						} catch (error) {
							writeResponse(createResponseForError(request.id, error));
						}
					})();
				}

				index = buffer.indexOf('\n');
			}
		});

		socket.on('error', (error) => {
			const message =
				error instanceof Error ? error.message : 'Неизвестная ошибка сокета';
			log.error(`ошибка сокета: ${message}`);
		});

		socket.on('close', () => {
			log.debug('соединение закрыто');
		});
	});
}

function listenServer(server: net.Server, config: IpcServerConfig): void {
	server.on('error', (error: unknown) => {
		if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
			const message = `Не удалось запустить IPC-сервер: порт ${
				config.port
			} уже используется. Измените настройку 1c-platform-tools.ipc.port.`;
			log.error(message);
			void vscode.window.showErrorMessage(message);
			return;
		}

		const message =
			error instanceof Error ? error.message : 'Неизвестная ошибка IPC-сервера';
		log.error(`ошибка сервера: ${message}`);
	});

	server.listen(config.port, config.host, () => {
		log.info(`сервер запущен на ${config.host}:${config.port}`);
	});
}

export function startIpcServer(context: vscode.ExtensionContext): void {
	const extensionId = 'yellow-hammer.1c-platform-tools';
	let config = readConfig();
	let activeServer: net.Server | null = null;

	const start = (): void => {
		if (!config.enabled) {
			log.debug('сервер отключен настройкой 1c-platform-tools.ipc.enabled');
			return;
		}
		activeServer = createServer(config, extensionId);
		listenServer(activeServer, config);
	};

	const stop = (): void => {
		if (activeServer) {
			activeServer.close();
			activeServer = null;
		}
	};

	start();

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('1c-platform-tools.ipc')) {
				stop();
				config = readConfig();
				start();
			}
		}),
		{ dispose: stop },
	);
}
