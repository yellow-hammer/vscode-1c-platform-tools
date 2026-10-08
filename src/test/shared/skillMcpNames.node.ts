/**
 * Имена MCP в навыках совпадают со списком, который публикует сервер.
 * Сервер берёт vscode.commands.getCommands() и оставляет isCommandExposedToMcp.
 * В этом тесте VS Code нет, поэтому тот же фильтр применяется к манифесту
 * и к командам, зарегистрированным без строки в package.json.
 * Запуск: npm run test:node
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test, type TestContext } from 'node:test';
import { isCommandExposedToMcp } from '../../shared/mcpCommandPolicy';
import { REGISTERED_WITHOUT_DECLARATION } from './registeredWithoutDeclaration';

const ROOT = path.resolve(__dirname, '../../..');
const COMMAND_PREFIX = '1c-platform-tools.';

/** Копия сокращений из mcp-1c-platform-tools/src/toolName.ts. Порядок важен. */
const ABBREVIATIONS: ReadonlyArray<readonly [string, string]> = [
	['initializeProjectStructure', 'initProjStruct'],
	['loadIncrementFromSrc', 'loadIncFromSrc'],
	['loadFromFilesByList', 'loadFromFiles'],
	['dumpIncrementToSrc', 'dumpIncToSrc'],
	['blockExternalResources', 'blockExtRes'],
	['decompileConfiguration', 'decompileCfg'],
	['decompileExtension', 'decompileExt'],
	['decompileProcessor', 'decompileProc'],
	['fromEditor', 'FromEd'],
	['initialize', 'init'],
	['Configuration', 'Cfg'],
	['Extension', 'Ext'],
	['Processor', 'Proc'],
	['Project', 'Proj'],
	['Structure', 'Struct'],
	['dependencies', 'deps'],
	['External', 'Ext'],
	['Resources', 'Res'],
	['Database', 'Db'],
	['Increment', 'Inc'],
	['Artifacts', 'Art'],
];

const MCP_SERVER_NAME = 'mcp-1c-platform-tools';
const MAX_TOOL_NAME_LENGTH = 60 - MCP_SERVER_NAME.length - 2;

/** Имя инструмента: домен и одно или несколько слов через `_`. */
const TOOL_NAME = /^[a-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/;

const TEST_EXTENSION_TOOLS = new Set([
	'test_loadExts',
	'test_dumpExts',
	'test_compileExts',
	'test_decompileExts',
	'test_addYaxunit',
]);

function loadCatalog(): Catalog {
	const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
		contributes: { commands: Array<{ command: string }> };
	};
	const declared = pkg.contributes.commands.map((command) => command.command);
	const knownIds = new Set<string>(declared);
	collectKeys(pkg, knownIds);
	for (const id of REGISTERED_WITHOUT_DECLARATION) {
		knownIds.add(id);
	}
	const exposed = new Map<string, string>();
	for (const id of [...declared, ...REGISTERED_WITHOUT_DECLARATION]) {
		if (isCommandExposedToMcp(id)) {
			exposed.set(id, commandIdToToolName(id));
		}
	}
	return { exposed, knownIds };
}

function commandIdToToolName(commandId: string): string {
	const shortId = commandId.startsWith(COMMAND_PREFIX)
		? commandId.slice(COMMAND_PREFIX.length)
		: commandId;
	let toolName = shortId;
	for (const [long, short] of ABBREVIATIONS) {
		toolName = toolName.replaceAll(long, short);
	}
	toolName = toolName.replaceAll('.', '_');
	if (toolName.length > MAX_TOOL_NAME_LENGTH) {
		toolName = '1cpt_' + toolName.slice(0, MAX_TOOL_NAME_LENGTH - 5);
	}
	return toolName;
}

function collectKeys(node: unknown, keys: Set<string>): void {
	if (Array.isArray(node)) {
		for (const item of node) {
			collectKeys(item, keys);
		}
		return;
	}
	if (node !== null && typeof node === 'object') {
		for (const [key, value] of Object.entries(node)) {
			if (key.startsWith(COMMAND_PREFIX)) {
				keys.add(key);
			}
			collectKeys(value, keys);
		}
	}
}

function skillFiles(): string[] {
	const root = path.join(ROOT, 'resources', 'skills');
	return fs.readdirSync(root)
		.map((name) => path.join(root, name, 'SKILL.md'))
		.filter((file) => fs.existsSync(file))
		.sort();
}

function backtickTokens(text: string): Set<string> {
	return new Set([...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1].trim()));
}

interface Catalog {
	exposed: Map<string, string>;
	knownIds: Set<string>;
}

function domainSkills(tool: string): string[] {
	const files: string[] = [];
	const add = (name: string): void => {
		files.push(path.join('resources', 'skills', name, 'SKILL.md'));
	};
	if (tool.startsWith('cf_')) {
		add('1c-platform-tools-configuration');
	}
	if (tool === 'cf_makeDist') {
		add('1c-platform-tools-support');
	}
	if (tool.startsWith('cfe_') || TEST_EXTENSION_TOOLS.has(tool)) {
		add('1c-platform-tools-extensions');
	}
	if (tool.startsWith('infobase_')) {
		add('1c-platform-tools-infobase');
	}
	if (tool.startsWith('epf_')) {
		add('1c-platform-tools-external');
	}
	if (tool.startsWith('run_')) {
		add('1c-platform-tools-run');
	}
	if (tool.startsWith('test_') || tool.startsWith('syntaxCheck_') || tool === 'epf_run') {
		add('1c-platform-tools-test');
	}
	if (tool.startsWith('deps_')) {
		add('1c-platform-tools-dependencies');
	}
	if (tool.startsWith('env_') || tool.startsWith('serviceFiles_')) {
		add('1c-platform-tools-config');
	}
	if (tool.startsWith('edt_')) {
		add('1c-platform-tools-edt');
	}
	if (tool.startsWith('session_')) {
		add('1c-platform-tools-session');
	}
	if (tool.startsWith('server_')) {
		add('1c-platform-tools-server');
	}
	if (tool.startsWith('tasks_')) {
		add('1c-platform-tools-tasks');
	}
	if (tool.startsWith('odata_')) {
		add('1c-platform-tools-odata');
	}
	if (tool.startsWith('pipelines_')) {
		add('1c-platform-tools-pipelines');
	}
	if (tool.startsWith('debug_')) {
		add('1c-platform-tools-debug');
	}
	return files;
}

describe('навыки и имена MCP', () => {
	const catalog = loadCatalog();
	const toolSet = new Set(catalog.exposed.values());

	test('сокращения совпадают с mcp-1c-platform-tools', (t: TestContext) => {
		const toolNamePath = path.resolve(ROOT, '..', 'mcp-1c-platform-tools', 'src', 'toolName.ts');
		if (!fs.existsSync(toolNamePath)) {
			t.skip('рядом нет репозитория mcp-1c-platform-tools, сверка сокращений не выполнена');
			return;
		}
		const source = fs.readFileSync(toolNamePath, 'utf8');
		const block = /const ABBREVIATIONS[\s\S]*?=\s*\[([\s\S]*?)\];/.exec(source);
		assert.ok(block);
		const pairs = [...block[1].matchAll(/\["([^"]+)",\s*"([^"]+)"\]/g)].map((match) => [match[1], match[2]]);
		assert.deepStrictEqual(pairs, ABBREVIATIONS.map((pair) => [...pair]));
	});

	test('известные command id дают ожидаемые имена', () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			['1c-platform-tools.syntaxCheck.run', 'syntaxCheck_run'],
			['1c-platform-tools.edt.sortProject', 'edt_sortProj'],
			['1c-platform-tools.test.loadExtensions', 'test_loadExts'],
			['1c-platform-tools.dependencies.initializeProjectStructure', 'deps_initProjStruct'],
			['1c-platform-tools.dependencies.initializePackagedef', 'deps_initPackagedef'],
			['1c-platform-tools.infobase.blockExternalResources', 'infobase_blockExtRes'],
			['1c-platform-tools.infobase.initialize', 'infobase_init'],
			['1c-platform-tools.epf.decompileProcessor', 'epf_decompileProc'],
			['1c-platform-tools.cf.loadIncrement', 'cf_loadInc'],
			['1c-platform-tools.project.initialize', 'project_init'],
			['1c-platform-tools.debug.measure.clear', 'debug_measure_clear'],
		];
		for (const [id, tool] of cases) {
			assert.equal(commandIdToToolName(id), tool, id);
			assert.equal(catalog.exposed.get(id), tool, id);
		}
	});

	test('в кавычках навыков только существующие инструменты и command id', () => {
		const unknownTools: string[] = [];
		const unknownIds: string[] = [];
		const wildcards: string[] = [];
		for (const file of skillFiles()) {
			const rel = path.relative(ROOT, file);
			for (const token of backtickTokens(fs.readFileSync(file, 'utf8'))) {
				if (token.includes('_*')) {
					wildcards.push(`${rel}: ${token}`);
				}
				if (TOOL_NAME.test(token) && !toolSet.has(token)) {
					unknownTools.push(`${rel}: ${token}`);
				}
				if (/^1c-platform-tools\.[A-Za-z0-9.]+$/.test(token) && !catalog.knownIds.has(token)) {
					unknownIds.push(`${rel}: ${token}`);
				}
			}
		}
		assert.deepStrictEqual(unknownTools, []);
		assert.deepStrictEqual(unknownIds, []);
		assert.deepStrictEqual(wildcards, []);
	});

	test('каждый опубликованный инструмент назван отдельной кавычкой', () => {
		const mcp = backtickTokens(fs.readFileSync(path.join(ROOT, 'resources', 'skills', '1c-platform-tools-mcp', 'SKILL.md'), 'utf8'));
		const full = backtickTokens(fs.readFileSync(path.join(ROOT, 'resources', 'skills', '1c-platform-tools', 'SKILL.md'), 'utf8'));
		const missingMcp: string[] = [];
		const missingFullTool: string[] = [];
		const missingFullId: string[] = [];
		const missingDomain: string[] = [];
		const domainCache = new Map<string, Set<string>>();
		const tokensOf = (rel: string): Set<string> => {
			const cached = domainCache.get(rel);
			if (cached) {
				return cached;
			}
			const tokens = backtickTokens(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
			domainCache.set(rel, tokens);
			return tokens;
		};
		for (const [id, tool] of catalog.exposed) {
			if (!mcp.has(tool)) {
				missingMcp.push(tool);
			}
			if (!full.has(tool)) {
				missingFullTool.push(tool);
			}
			if (!full.has(id)) {
				missingFullId.push(id);
			}
			for (const domain of domainSkills(tool)) {
				if (!tokensOf(domain).has(tool)) {
					missingDomain.push(`${tool} → ${domain}`);
				}
			}
		}
		assert.deepStrictEqual(missingMcp, []);
		assert.deepStrictEqual(missingFullTool, []);
		assert.deepStrictEqual(missingFullId, []);
		assert.deepStrictEqual(missingDomain, []);
		assert.equal(catalog.exposed.size, toolSet.size, 'два command id схлопнулись в одно имя');
		assert.equal(full.has('cf_load') && full.has('cf_loadInc'), true);
	});

	test('description навыка с двоеточием заключено в кавычки', () => {
		const bare: string[] = [];
		for (const file of skillFiles()) {
			const text = fs.readFileSync(file, 'utf8');
			const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
			if (!front) {
				bare.push(`${path.relative(ROOT, file)}: нет заголовка`);
				continue;
			}
			const line = front[1].split(/\r?\n/).find((item) => item.startsWith('description:'));
			if (!line) {
				bare.push(`${path.relative(ROOT, file)}: нет description`);
				continue;
			}
			const value = line.slice('description:'.length).trim();
			const quoted = (value.startsWith('"') && value.endsWith('"'))
				|| (value.startsWith("'") && value.endsWith("'"));
			if (!quoted && value.includes(': ')) {
				bare.push(path.relative(ROOT, file));
			}
		}
		assert.deepStrictEqual(bare, []);
	});

	test('каталоги навыков совпадают со списком установки', () => {
		const source = fs.readFileSync(path.join(ROOT, 'src', 'commands', 'skillsCommands.ts'), 'utf8');
		const block = /const ONE_CPT_SKILL_IDS = \[([\s\S]*?)\] as const/.exec(source);
		assert.ok(block);
		const listed = [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
		const onDisk = fs.readdirSync(path.join(ROOT, 'resources', 'skills'))
			.filter((name) => fs.existsSync(path.join(ROOT, 'resources', 'skills', name, 'SKILL.md')))
			.sort();
		assert.deepStrictEqual(listed, onDisk);
	});
});
