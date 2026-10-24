/**
 * Вид «Рабочая область»: проекты окна, подпроекты, вторые конфигурации и не проекты.
 * @module projects/workspaceProjectsView
 */

import * as vscode from 'vscode';
import { readProjectLaunch, type ProjectLaunch } from '../../shared/projectState';
import {
	isFolderRootProject,
	projectDisplayName,
	projectRootKey,
	sameProjectRoot,
	type ProjectCandidate,
	type WorkspaceProject,
	type WorkspaceProjectsSnapshot,
} from '../../shared/workspaceProjects';
import { SELECT_PROJECT_COMMAND } from './projectCommandIds';
import {
	candidateDescription,
	candidateName,
	candidateTooltip,
	folderRootProjectsFirst,
	isCurrentProject,
	nestedProjectLocation,
	projectDescription,
	projectTooltip,
} from './projectPresentation';
import type { WorkspaceProjectsSource } from './workspaceProjectsSource';

export const WORKSPACE_PROJECTS_VIEW_ID = '1c-platform-tools-projects-workspace';

/** contextValue строк вида. */
export const PROJECT_ITEM_CONTEXT = 'workspaceProject';
export const CURRENT_PROJECT_ITEM_CONTEXT = 'workspaceProjectCurrent';
export const EXTRA_CONFIGURATION_ITEM_CONTEXT = 'workspaceExtraConfiguration';
export const CANDIDATES_GROUP_CONTEXT = 'workspaceCandidates';
export const CANDIDATE_ITEM_CONTEXT = 'workspaceCandidate';

export interface ProjectTreeNode {
	readonly kind: 'project';
	readonly project: WorkspaceProject;
}

export interface ExtraConfigurationTreeNode {
	readonly kind: 'extraConfiguration';
	readonly candidate: ProjectCandidate;
}

export interface CandidatesGroupTreeNode {
	readonly kind: 'candidates';
}

export interface CandidateTreeNode {
	readonly kind: 'candidate';
	readonly candidate: ProjectCandidate;
}

export type WorkspaceProjectsNode = ProjectTreeNode | ExtraConfigurationTreeNode | CandidatesGroupTreeNode | CandidateTreeNode;

const NODE_KINDS = new Set<string>(['project', 'extraConfiguration', 'candidates', 'candidate']);

/** Узел вида «Рабочая область». */
export function isWorkspaceProjectsNode(value: unknown): value is WorkspaceProjectsNode {
	return typeof value === 'object' && value !== null && NODE_KINDS.has(String((value as { kind?: unknown }).kind));
}

function childOf(parent: string | undefined, root: string): boolean {
	return parent !== undefined && sameProjectRoot(parent, root);
}

/** Строки вида «Рабочая область». */
export class WorkspaceProjectsTreeProvider implements vscode.TreeDataProvider<WorkspaceProjectsNode>, vscode.Disposable {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;
	private readonly nodes = new Map<string, WorkspaceProjectsNode>();
	private readonly subscriptions: vscode.Disposable[];

	/**
	 * @param source - Проекты окна
	 * @param launchOf - Именованный профиль и окружение проекта
	 * @param onDidChangeLaunch - Смена профиля или окружения в любом проекте
	 */
	constructor(
		private readonly source: WorkspaceProjectsSource,
		private readonly launchOf: (root: string) => ProjectLaunch = readProjectLaunch,
		onDidChangeLaunch?: vscode.Event<void>
	) {
		this.subscriptions = [
			source.onDidChangeProjects(() => this.refresh()),
			source.onDidChangeCurrentProject(() => this.refresh()),
			...(onDidChangeLaunch ? [onDidChangeLaunch(() => this.refresh())] : []),
		];
	}

	refresh(): void {
		this.nodes.clear();
		this.changed.fire();
	}

	getChildren(element?: WorkspaceProjectsNode): WorkspaceProjectsNode[] {
		const snapshot = this.source.snapshotNow();
		if (!element) {
			const top = folderRootProjectsFirst(snapshot.projects.filter((project) => !this.knownParent(snapshot, project.parent))).map(
				(project) => this.projectNode(project)
			);
			return this.groupedCandidates(snapshot).length > 0 ? [...top, this.groupNode()] : top;
		}
		switch (element.kind) {
			case 'project':
				return [
					...snapshot.projects
						.filter((project) => childOf(project.parent, element.project.root))
						.map((project) => this.projectNode(project)),
					...snapshot.candidates
						.filter((candidate) => candidate.kind === 'extraConfiguration' && childOf(candidate.parent, element.project.root))
						.map((candidate) => this.extraConfigurationNode(candidate)),
				];
			case 'candidates':
				return this.groupedCandidates(snapshot).map((candidate) => this.candidateNode(candidate));
			default:
				return [];
		}
	}

	getParent(element: WorkspaceProjectsNode): WorkspaceProjectsNode | undefined {
		const snapshot = this.source.snapshotNow();
		switch (element.kind) {
			case 'project':
			case 'extraConfiguration': {
				const parentRoot = element.kind === 'project' ? element.project.parent : element.candidate.parent;
				const parent = this.knownParent(snapshot, parentRoot);
				if (parent) {
					return this.projectNode(parent);
				}
				return element.kind === 'extraConfiguration' ? this.groupNode() : undefined;
			}
			case 'candidate':
				return this.groupNode();
			default:
				return undefined;
		}
	}

	getTreeItem(element: WorkspaceProjectsNode): vscode.TreeItem {
		switch (element.kind) {
			case 'project':
				return this.projectItem(element);
			case 'extraConfiguration': {
				const { candidate } = element;
				const item = new vscode.TreeItem(candidate.configuration.name || candidateName(candidate));
				item.id = `extraConfiguration:${projectRootKey(candidate.root)}`;
				item.description = candidateDescription(candidate);
				item.tooltip = candidateTooltip(candidate);
				item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
				item.contextValue = EXTRA_CONFIGURATION_ITEM_CONTEXT;
				return item;
			}
			case 'candidates': {
				const item = new vscode.TreeItem('Не проекты', vscode.TreeItemCollapsibleState.Expanded);
				item.id = 'candidates';
				item.contextValue = CANDIDATES_GROUP_CONTEXT;
				return item;
			}
			case 'candidate': {
				const { candidate } = element;
				const item = new vscode.TreeItem(candidateName(candidate));
				item.id = `candidate:${projectRootKey(candidate.root)}`;
				item.description = candidateDescription(candidate);
				item.tooltip = candidateTooltip(candidate);
				item.iconPath = new vscode.ThemeIcon('folder');
				item.contextValue = CANDIDATE_ITEM_CONTEXT;
				return item;
			}
		}
	}

	dispose(): void {
		for (const subscription of this.subscriptions) {
			subscription.dispose();
		}
		this.changed.dispose();
	}

	private projectItem(element: ProjectTreeNode): vscode.TreeItem {
		const { project } = element;
		const snapshot = this.source.snapshotNow();
		const current = isCurrentProject(project, this.source.selectedRoot());
		const collapsible =
			this.getChildren(element).length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
		const parent = this.knownParent(snapshot, project.parent);
		const siblings = snapshot.projects.filter((other) =>
			parent ? childOf(other.parent, parent.root) : !this.knownParent(snapshot, other.parent)
		);
		const item = new vscode.TreeItem(projectDisplayName(project, siblings), collapsible);
		item.id = `project:${projectRootKey(project.root)}`;
		item.description = projectDescription(project, current, {
			location: nestedProjectLocation(project),
			...this.launchOf(project.root),
		});
		item.tooltip = projectTooltip(project);
		item.iconPath = !isFolderRootProject(project)
			? new vscode.ThemeIcon(
					'file-submodule',
					new vscode.ThemeColor(current ? 'testing.iconPassed' : 'gitDecoration.submoduleResourceForeground')
				)
			: new vscode.ThemeIcon('repo', current ? new vscode.ThemeColor('testing.iconPassed') : undefined);
		item.contextValue = current ? CURRENT_PROJECT_ITEM_CONTEXT : PROJECT_ITEM_CONTEXT;
		item.command = { command: SELECT_PROJECT_COMMAND, title: 'Сделать текущим', arguments: [project.root] };
		return item;
	}

	private knownParent(snapshot: WorkspaceProjectsSnapshot, parent: string | undefined): WorkspaceProject | undefined {
		return parent === undefined ? undefined : snapshot.projects.find((project) => sameProjectRoot(project.root, parent));
	}

	/** Папки без packagedef и вторые конфигурации, чей проект не найден. */
	private groupedCandidates(snapshot: WorkspaceProjectsSnapshot): ProjectCandidate[] {
		return snapshot.candidates.filter(
			(candidate) => candidate.kind === 'folder' || !this.knownParent(snapshot, candidate.parent)
		);
	}

	private remember<T extends WorkspaceProjectsNode>(key: string, create: () => T): T {
		const found = this.nodes.get(key);
		if (found) {
			return found as T;
		}
		const node = create();
		this.nodes.set(key, node);
		return node;
	}

	private projectNode(project: WorkspaceProject): ProjectTreeNode {
		return this.remember(`project:${projectRootKey(project.root)}`, () => ({ kind: 'project', project }));
	}

	private extraConfigurationNode(candidate: ProjectCandidate): ExtraConfigurationTreeNode {
		return this.remember(`extraConfiguration:${projectRootKey(candidate.root)}`, () => ({ kind: 'extraConfiguration', candidate }));
	}

	private groupNode(): CandidatesGroupTreeNode {
		return this.remember('candidates', () => ({ kind: 'candidates' }));
	}

	private candidateNode(candidate: ProjectCandidate): CandidateTreeNode {
		return this.remember(`candidate:${projectRootKey(candidate.root)}`, () => ({ kind: 'candidate', candidate }));
	}
}

/**
 * Корень строки вида: проект, вторая конфигурация или не проект.
 *
 * @param node - Узел вида
 */
export function nodeRoot(node: WorkspaceProjectsNode): string | undefined {
	switch (node.kind) {
		case 'project':
			return node.project.root;
		case 'extraConfiguration':
		case 'candidate':
			return node.candidate.root;
		default:
			return undefined;
	}
}
