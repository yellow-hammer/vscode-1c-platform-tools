#!/usr/bin/env node
/**
 * Запуск vsce package в том же процессе после патча require('minimatch').
 * Устраняет ошибку "(0 , minimatch_1.default) is not a function" в цепочке vsce/glob/minimatch.
 */
const Module = require('module');
const path = require('path');

const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
	const m = origRequire.apply(this, arguments);
	if (id === 'minimatch' && m && typeof m.minimatch === 'function') {
		m.default = m.minimatch;
	}
	return m;
};

const vscePath = path.join(__dirname, '..', 'node_modules', '@vscode', 'vsce', 'vsce');
require(vscePath);
