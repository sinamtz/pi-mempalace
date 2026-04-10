/**
 * Onboarding — Guided first-run setup for MemPalace.
 *
 * Handles the initial configuration of the memory palace:
 * - Collecting user information (name, role, projects)
 * - Setting up initial wing structure
 * - Creating identity file
 * - Seeding entity registry with initial people
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getDataDir } from "../broker";
import { addMemory } from "../memory";
import { embed } from "../embed";
import { saveIdentity, DEFAULT_IDENTITY_TEMPLATE } from "../layers/layer0";
import { logger } from "../logger";

/** Onboarding state */
export interface OnboardingState {
	/** Whether onboarding has been completed */
	isCompleted: boolean;
	/** Current step in onboarding */
	currentStep: OnboardingStep;
	/** Collected user information */
	userInfo?: UserInfo;
	/** Generated wing configuration */
	wingConfig?: WingConfig;
	/** Onboarding timestamp */
	startedAt: Date | null;
	/** Completion timestamp */
	completedAt: Date | null;
}

/** Onboarding step */
export type OnboardingStep = "welcome" | "collect_info" | "configure_wings" | "seed_memories" | "complete";

/** User information collected during onboarding */
export interface UserInfo {
	/** User's name */
	name: string;
	/** User's role/title */
	role: string;
	/** Brief description of work focus */
	focus: string;
	/** Key people to track (names) */
	keyPeople: string[];
	/** Key projects to track (names) */
	keyProjects: string[];
	/** Preferred wing structure */
	preferredWings: string[];
}

/** Wing configuration for the palace */
export interface WingConfig {
	/** Wing definitions */
	wings: Array<{
		name: string;
		description: string;
		defaultRooms: string[];
	}>;
	/** Default entity registry entries */
	entities: Array<{
		name: string;
		type: string;
		properties: Record<string, unknown>;
	}>;
}

/** Default wing configuration template */
export const DEFAULT_WING_CONFIG: WingConfig = {
	wings: [
		{
			name: "identity",
			description: "Core identity and self-knowledge",
			defaultRooms: ["role", "values", "capabilities"],
		},
		{
			name: "projects",
			description: "Work on software projects",
			defaultRooms: ["active", "completed", "archived"],
		},
		{
			name: "people",
			description: "Information about people",
			defaultRooms: ["colleagues", "contacts", "mentors"],
		},
		{
			name: "knowledge",
			description: "Technical knowledge and learnings",
			defaultRooms: ["concepts", "patterns", "references"],
		},
		{
			name: "conversations",
			description: "Meeting notes and discussions",
			defaultRooms: ["meetings", "decisions", "questions"],
		},
	],
	entities: [],
};

/** State file for onboarding persistence */
const ONBOARDING_STATE_FILE = "onboarding-state.json";

/**
 * Get the onboarding state file path.
 */
function getStatePath(): string {
	return path.join(getDataDir(), ONBOARDING_STATE_FILE);
}

/**
 * Check if onboarding is needed.
 *
 * Onboarding is needed if:
 * - No identity file exists
 * - No memories exist in core wings
 */
export async function isOnboardingNeeded(): Promise<boolean> {
	const statePath = getStatePath();

	try {
		const content = await fs.readFile(statePath, "utf-8");
		const state = JSON.parse(content) as OnboardingState;

		return !state.isCompleted;
	} catch {
		// State file doesn't exist, onboarding needed
		return true;
	}
}

/**
 * Load the current onboarding state.
 */
export async function loadOnboardingState(): Promise<OnboardingState> {
	const statePath = getStatePath();

	try {
		const content = await fs.readFile(statePath, "utf-8");
		const state = JSON.parse(content) as OnboardingState;

		// Convert date strings back to Date objects
		if (state.startedAt) {
			state.startedAt = new Date(state.startedAt);
		}
		if (state.completedAt) {
			state.completedAt = new Date(state.completedAt);
		}

		return state;
	} catch {
		// Return default state
		return {
			isCompleted: false,
			currentStep: "welcome",
			startedAt: null,
			completedAt: null,
		};
	}
}

/**
 * Save onboarding state to disk.
 */
export async function saveOnboardingState(state: OnboardingState): Promise<void> {
	const statePath = getStatePath();

	await fs.mkdir(path.dirname(statePath), { recursive: true });
	await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");

	logger.debug("Onboarding state saved", { step: state.currentStep });
}

/**
 * Start a new onboarding session.
 */
export async function startOnboarding(): Promise<OnboardingState> {
	const state: OnboardingState = {
		isCompleted: false,
		currentStep: "collect_info",
		startedAt: new Date(),
		completedAt: null,
	};

	await saveOnboardingState(state);
	logger.info("Onboarding started");

	return state;
}

/**
 * Submit user information during onboarding.
 *
 * @param userInfo - Collected user information.
 * @returns Updated onboarding state.
 */
export async function submitUserInfo(userInfo: UserInfo): Promise<OnboardingState> {
	const state = await loadOnboardingState();

	state.userInfo = userInfo;
	state.currentStep = "configure_wings";

	await saveOnboardingState(state);
	logger.info("User info collected", {
		name: userInfo.name,
		role: userInfo.role,
	});

	return state;
}

/**
 * Generate wing configuration based on user info.
 *
 * @param userInfo - User information.
 * @returns Generated wing configuration.
 */
export function generateWingConfig(userInfo: UserInfo): WingConfig {
	const config: WingConfig = {
		wings: [...DEFAULT_WING_CONFIG.wings],
		entities: [],
	};

	// Add projects as wings if there are key projects
	if (userInfo.keyProjects.length > 0) {
		for (const project of userInfo.keyProjects) {
			const normalizedName = project.toLowerCase().replace(/\s+/g, "-");
			config.wings.push({
				name: normalizedName,
				description: `Work on ${project}`,
				defaultRooms: ["overview", "issues", "notes"],
			});
		}
	}

	// Add people as entities
	for (const person of userInfo.keyPeople) {
		config.entities.push({
			name: person,
			type: "person",
			properties: {
				addedDuring: "onboarding",
			},
		});
	}

	return config;
}

/**
 * Submit wing configuration during onboarding.
 *
 * @param wingConfig - Wing configuration.
 * @returns Updated onboarding state.
 */
export async function submitWingConfig(wingConfig: WingConfig): Promise<OnboardingState> {
	const state = await loadOnboardingState();

	state.wingConfig = wingConfig;
	state.currentStep = "seed_memories";

	await saveOnboardingState(state);
	logger.info("Wing config submitted", {
		wingCount: wingConfig.wings.length,
		entityCount: wingConfig.entities.length,
	});

	return state;
}

/**
 * Seed initial memories based on onboarding data.
 *
 * This creates the foundational memories that will be
 * available in L0 and L1.
 */
export async function seedInitialMemories(): Promise<void> {
	const state = await loadOnboardingState();

	if (!state.userInfo) {
		throw new Error("Cannot seed memories without user info");
	}

	const userInfo = state.userInfo;

	// Create identity memory
	const identityText =
		`I am ${userInfo.name}, a ${userInfo.role}. ` +
		`My focus is on ${userInfo.focus}. ` +
		`I work with ${userInfo.keyPeople.join(", ") || "various people"}. ` +
		`I am involved in ${userInfo.keyProjects.join(", ") || "various projects"}.`;

	const identityEmbedding = await embed(identityText);

	await addMemory({
		text: identityText,
		embedding: identityEmbedding,
		wing: "identity",
		room: "self",
		source: "onboarding",
	});

	// Create wing description memories
	if (state.wingConfig) {
		for (const wing of state.wingConfig.wings) {
			const wingText = `Wing "${wing.name}": ${wing.description}. ` + `Rooms: ${wing.defaultRooms.join(", ")}.`;

			const wingEmbedding = await embed(wingText);

			await addMemory({
				text: wingText,
				embedding: wingEmbedding,
				wing: "identity",
				room: "wings",
				source: "onboarding",
			});
		}
	}

	logger.info("Initial memories seeded");
}

/**
 * Save the identity file.
 *
 * Uses the DEFAULT_IDENTITY_TEMPLATE with user-specific customization.
 */
export async function saveOnboardingIdentity(userInfo: UserInfo): Promise<void> {
	const identity = DEFAULT_IDENTITY_TEMPLATE.replace(
		"You are an AI coding assistant",
		`You are ${userInfo.name}, a ${userInfo.role}`,
	);

	await saveIdentity(identity);
}

/**
 * Complete the onboarding process.
 *
 * Finalizes all onboarding steps and marks the process as complete.
 */
export async function completeOnboarding(): Promise<OnboardingState> {
	const state = await loadOnboardingState();

	// Seed memories if not already done
	if (state.currentStep !== "complete") {
		await seedInitialMemories();

		// Save identity file
		if (state.userInfo) {
			await saveOnboardingIdentity(state.userInfo);
		}
	}

	state.isCompleted = true;
	state.currentStep = "complete";
	state.completedAt = new Date();

	await saveOnboardingState(state);
	logger.info("Onboarding completed");

	return state;
}

/**
 * Run the complete onboarding flow programmatically.
 *
 * This is a convenience function that runs through all onboarding
 * steps without user interaction (for testing or automated setup).
 *
 * @param userInfo - User information.
 * @param customWings - Optional custom wing configuration.
 */
export async function runOnboarding(userInfo: UserInfo, customWings?: WingConfig): Promise<OnboardingState> {
	// Start onboarding
	await startOnboarding();

	// Submit user info
	await submitUserInfo(userInfo);

	// Generate or use custom wing config
	const wingConfig = customWings ?? generateWingConfig(userInfo);
	await submitWingConfig(wingConfig);

	// Complete onboarding (seeds memories)
	const finalState = await completeOnboarding();

	return finalState;
}

/**
 * Reset onboarding state.
 *
 * Allows re-running onboarding from the beginning.
 */
export async function resetOnboarding(): Promise<OnboardingState> {
	const statePath = getStatePath();

	try {
		await fs.unlink(statePath);
	} catch {
		// Ignore if file doesn't exist
	}

	logger.info("Onboarding state reset");

	return startOnboarding();
}
