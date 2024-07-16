import {
	App,
	Editor,
	EditorPosition,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";

// Data structures
interface MyPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: "default",
};

type EloRelationOp = "eq" | "gt" | "lt" | "nop";

interface EloRelation {
	op: EloRelationOp;
	value: number;
}

interface EloItem {
	title: string;
	estimatedElo: number;
	eloRelations: EloRelation[];
}

// Config
const ITEM_INCUBATION_TIME = 4;
const DEFAULT_ELO = 600;
const ELO_CODE = "elolist";
const SHOW_AS_PRE = true;
const SHOW_AS_TABLE = false;

function updateRating(item: EloItem) {
	function pA(a: EloItem, b: EloItem) {
		return 1 / (1 + Math.pow(10, (b.estimatedElo - a.estimatedElo) / 400));
	}
	const isDefinite =
		item.eloRelations.length === 1 && item.eloRelations[0].op == "eq";
	return {
		afterWinAgainst(looserItem: EloItem) {
			if (isDefinite) {
				const itemNewElo =
					item.estimatedElo + 32 * (1 - pA(item, looserItem));
				item.estimatedElo = itemNewElo;
				item.eloRelations = [{ op: "eq", value: itemNewElo }];
			} else {
				const otherNewElo =
					looserItem.estimatedElo - 32 * pA(looserItem, item);
				item.eloRelations.push({
					op: "gt",
					value: otherNewElo,
				});
				item.estimatedElo = estimateElo(item);
				if (item.eloRelations.length > ITEM_INCUBATION_TIME) {
					item.eloRelations = [
						{ op: "eq", value: item.estimatedElo },
					];
				}
			}
		},
		afterLossAgainst(winnerItem: EloItem) {
			if (isDefinite) {
				const itemNewElo =
					item.estimatedElo - 32 * pA(item, winnerItem);
				item.estimatedElo = itemNewElo;
				item.eloRelations = [{ op: "eq", value: itemNewElo }];
			} else {
				const otherNewElo =
					winnerItem.estimatedElo + 32 * (1 - pA(winnerItem, item));

				item.eloRelations.push({
					op: "lt",
					value: otherNewElo,
				});
				item.estimatedElo = estimateElo(item);
				if (item.eloRelations.length > ITEM_INCUBATION_TIME) {
					item.eloRelations = [
						{ op: "eq", value: item.estimatedElo },
					];
				}
			}
		},
	};
}

function estimateElo(item: EloItem) {
	if (item.eloRelations.length > 0) {
		// determine bounds
		let minElo = item.eloRelations[0].value;
		let maxElo = item.eloRelations[0].value;
		for (let i = 1; i < item.eloRelations.length; i++) {
			switch (item.eloRelations[i].op) {
				case "eq":
					minElo = Math.min(item.eloRelations[1].value, minElo);
					maxElo = Math.max(item.eloRelations[1].value, maxElo);
					break;
				case "lt":
					minElo = Math.min(item.eloRelations[1].value, minElo);
					break;
				case "gt":
					maxElo = Math.max(item.eloRelations[1].value, maxElo);
					break;
			}
		}
		minElo = minElo - 1;
		maxElo = maxElo + 1;
		// find best integer elo within bounds
		// todo: this would be better suited for a dynamic programming approach... but winging it here also isnt bad
		let bestError = 0;
		let bestTestElo = 0;
		for (let testElo = minElo; testElo <= maxElo; testElo += 1) {
			let error = 0;
			for (let i = 0; i < item.eloRelations.length; i++) {
				let relError = 0;
				switch (item.eloRelations[i].op) {
					case "eq":
						relError = Math.abs(
							item.eloRelations[i].value - testElo
						);
						break;
					case "lt":
						relError = Math.max(
							0,
							testElo - item.eloRelations[i].value + 1
						);
						break;
					case "gt":
						relError = Math.max(
							0,
							item.eloRelations[i].value - testElo + 1
						);
						break;
				}
				error += relError * relError;
			}
			//console.log(`testElo=${testElo} error=${error}`);
			if (testElo == minElo || error < bestError) {
				bestError = error;
				bestTestElo = testElo;
			}
		}

		return bestTestElo;
	}
	return DEFAULT_ELO;
}

function parseEloRelation(s: string): EloRelation {
	s = s.trim();
	let op: EloRelationOp = "eq";
	if (s[0] == "<") {
		op = "lt";
		s = s.substring(1);
	} else if (s[0] == ">") {
		op = "gt";
		s = s.substring(1);
	}

	const value = parseFloat(s);
	if (Number.isNaN(value)) {
		op = "nop";
	}

	return {
		op: op,
		value: value,
	};
}

function parseEloItem(s: string): EloItem {
	const relationsMatch = s.match(/^(.+)\((.*)\)$/);
	if (relationsMatch) {
		const item: EloItem = {
			title: relationsMatch[1].trim(),
			estimatedElo: DEFAULT_ELO,
			eloRelations: relationsMatch[2].split(",").map(parseEloRelation),
		};
		item.estimatedElo = estimateElo(item);
		return item;
	}
	return {
		title: s.trim(),
		estimatedElo: DEFAULT_ELO,
		eloRelations: [],
	};
}

function parseEloItems(s: string) {
	return s
		.split("\n")
		.map((item) => item.trim())
		.filter((item) => !!item)
		.map((item) => parseEloItem(item))
		.sort((a, b) => b.estimatedElo - a.estimatedElo);
}

function stringifyEloRelations(item: EloItem) {
	const relToStr = {
		lt: "<",
		gt: ">",
		eq: "",
		nop: "", // satisfy typescript compiler
	};
	return item.eloRelations
		.filter((rel) => rel.op !== "nop")
		.map((rel) => `${relToStr[rel.op]}${Math.floor(rel.value * 100) / 100}`)
		.join(", ");
}

function stringifyEloItems(items: EloItem[]) {
	return items
		.map((item) =>
			item.eloRelations.length > 0
				? `${item.title} (${stringifyEloRelations(item)})`
				: item.title
		)
		.join("\n");
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerMarkdownCodeBlockProcessor(ELO_CODE, (source, el, ctx) => {
			const markDownView: MarkdownView | null =
				this.app.workspace.getActiveViewOfType(MarkdownView);
			const editor = markDownView?.editor;

			function replace(s: string) {
				const section = ctx.getSectionInfo(el);
				if (section) {
					const start: EditorPosition = {
						line: section.lineStart + 1,
						ch: 0,
					};
					const end: EditorPosition = {
						line: section.lineEnd,
						ch: 0,
					};
					editor?.replaceRange(s + "\n", start, end);
				}
			}

			const items = parseEloItems(source);

			if (SHOW_AS_PRE) {
				const pre = el.createEl("pre");
				pre.innerText = source;
			}

			// Display table
			if (SHOW_AS_TABLE) {
				const table = el.createEl("table");
				const body = table.createEl("tbody");
				for (let i = 0; i < items.length; i++) {
					const item = items[i];
					const cols: string[] = [
						item.title,
						`${item.estimatedElo}`,
						stringifyEloRelations(item),
					];
					const row = body.createEl("tr");
					for (let j = 0; j < cols.length; j++) {
						row.createEl("td", { text: cols[j] });
					}
				}
			}

			if (items.length > 1) {
				const leftIndex = Math.floor(Math.random() * items.length);
				let rightIndex = leftIndex;
				while (rightIndex === leftIndex) {
					rightIndex = Math.floor(Math.random() * items.length);
				}
				const leftItem = items[leftIndex];
				const rightItem = items[rightIndex];

				const chooser = el.createEl("div");
				const chooseLeft = chooser.createEl("button");
				chooseLeft.textContent = leftItem.title;
				chooseLeft.onclick = () => {
					const leftItemAfterChoosing = { ...leftItem };
					const rightItemAfterChoosing = { ...rightItem };
					updateRating(leftItemAfterChoosing).afterWinAgainst(
						rightItem
					);
					updateRating(rightItemAfterChoosing).afterLossAgainst(
						leftItem
					);
					items[leftIndex] = leftItemAfterChoosing;
					items[rightIndex] = rightItemAfterChoosing;
					items.sort((a, b) => b.estimatedElo - a.estimatedElo);
					replace(stringifyEloItems(items));
				};

				const chooseRight = chooser.createEl("button");
				chooseRight.textContent = rightItem.title;
				chooseRight.onclick = () => {
					const leftItemAfterChoosing = { ...leftItem };
					const rightItemAfterChoosing = { ...rightItem };
					updateRating(leftItemAfterChoosing).afterLossAgainst(
						rightItem
					);
					updateRating(rightItemAfterChoosing).afterWinAgainst(
						leftItem
					);
					items[leftIndex] = leftItemAfterChoosing;
					items[rightIndex] = rightItemAfterChoosing;
					items.sort((a, b) => b.estimatedElo - a.estimatedElo);

					replace(stringifyEloItems(items));
				};
			}
		});
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
