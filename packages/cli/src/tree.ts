import { buildRouteMap } from "@stricli/core";
import type { Command, CommandContext, RouteMap } from "@stricli/core";

/**
 * Turn dotted operation ids into stricli's nested route maps.
 *
 * `smiths.runs.submit` is `ic smiths runs submit`: the id's structure is the
 * command structure, so the tree needs no separate description and cannot
 * drift from the API's own names.
 */

export interface Leaf {
	id: string;
	command: Command<CommandContext>;
}

interface Node {
	children: Map<string, Node | Command<CommandContext>>;
}

const isNode = (v: Node | Command<CommandContext>): v is Node =>
	(v as Node).children instanceof Map;

export function buildTree(
	leaves: readonly Leaf[],
	rootBrief: string,
): RouteMap<CommandContext> {
	const root: Node = { children: new Map() };

	for (const leaf of leaves) {
		const segs = leaf.id.split(".");
		const name = segs.pop() as string;
		let node = root;
		const walked: string[] = [];
		for (const seg of segs) {
			walked.push(seg);
			const existing = node.children.get(seg);
			if (existing && !isNode(existing))
				throw new Error(
					`${walked.join(".")} is both a command and a group of commands.`,
				);
			const next: Node = (existing as Node) ?? { children: new Map() };
			node.children.set(seg, next);
			node = next;
		}
		const clash = node.children.get(name);
		if (clash)
			throw new Error(
				isNode(clash)
					? `${[...walked, name].join(".")} is both a command and a group of commands.`
					: `${[...walked, name].join(".")} is registered twice.`,
			);
		node.children.set(name, leaf.command);
	}

	const finish = (node: Node, brief: string): RouteMap<CommandContext> => {
		const routes: Record<
			string,
			RouteMap<CommandContext> | Command<CommandContext>
		> = {};
		for (const [name, child] of node.children)
			routes[name] = isNode(child) ? finish(child, name) : child;
		return buildRouteMap({ routes, docs: { brief } });
	};

	return finish(root, rootBrief);
}
