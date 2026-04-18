/**
 * Модель проекта. Profile не используется — только name, rootPath, tags, enabled.
 */

export interface Project {
	name: string;
	rootPath: string;
	paths: string[];
	tags: string[];
	enabled: boolean;
}

export function createProject(name: string, rootPath: string): Project {
	return {
		name,
		rootPath,
		paths: [],
		tags: [],
		enabled: true,
	};
}
