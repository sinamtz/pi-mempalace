/**
 * Agent Diary — Daily memory logging and session summaries.
 *
 * The diary tracks agent activity over time:
 * - Daily memory logging
 * - Session summaries
 * - Activity tracking
 * - Reflection entries
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getDataDir } from "../db";
import { addMemory } from "../memory";
import { embed } from "../embed";
import { logger } from "../logger";

/** Diary entry type */
export type DiaryEntryType = "session_start" | "session_end" | "daily_summary" | "reflection" | "milestone" | "note";

/** A diary entry */
export interface DiaryEntry {
	/** Unique entry ID */
	id: string;
	/** Entry type */
	type: DiaryEntryType;
	/** Entry title */
	title: string;
	/** Entry content */
	content: string;
	/** When the entry was created */
	createdAt: Date;
	/** Associated session ID (if applicable) */
	sessionId?: string;
	/** Tags for categorization */
	tags: string[];
	/** Related memory IDs */
	relatedMemories: string[];
	/** Key accomplishments */
	accomplishments: string[];
	/** Challenges faced */
	challenges: string[];
	/** Next steps */
	nextSteps: string[];
}

/** Session information */
export interface Session {
	/** Unique session ID */
	id: string;
	/** Session start time */
	startedAt: Date;
	/** Session end time (null if active) */
	endedAt: Date | null;
	/** Number of memories created during session */
	memoryCount: number;
	/** Session summary */
	summary: string;
	/** Key actions taken */
	actions: string[];
	/** Files worked on */
	files: string[];
	/** Commands executed */
	commands: string[];
}

/** Daily summary */
export interface DailySummary {
	/** The date (YYYY-MM-DD) */
	date: string;
	/** Total sessions this day */
	sessionCount: number;
	/** Total memories created */
	memoryCount: number;
	/** Active wings this day */
	activeWings: string[];
	/** Key accomplishments */
	accomplishments: string[];
	/** Challenges encountered */
	challenges: string[];
	/** Overall sentiment/mood */
	sentiment: "productive" | "challenging" | "mixed" | "neutral";
	/** Generated summary text */
	summary: string;
}

/** Configuration for diary operations */
export interface DiaryConfig {
	/** Wing for diary memories (default: "diary") */
	wing: string;
	/** Room prefix for entries */
	roomPrefix: string;
	/** Include in essential story */
	includeInEssential: boolean;
}

/** Default diary configuration */
const DEFAULT_DIARY_CONFIG: DiaryConfig = {
	wing: "diary",
	roomPrefix: "entries",
	includeInEssential: true,
};

/** Directory for diary files */
const DIARY_DIR = "diary";

/**
 * Get the diary directory path.
 */
function getDiaryPath(): string {
	return path.join(getDataDir(), DIARY_DIR);
}

/**
 * Get path for diary state file.
 */
function getDiaryStatePath(): string {
	return path.join(getDiaryPath(), "state.json");
}

/**
 * Initialize diary directory structure.
 */
async function ensureDiaryDir(): Promise<void> {
	const diaryPath = getDiaryPath();
	await fs.mkdir(diaryPath, { recursive: true });
}

/**
 * Generate a unique entry ID.
 */
function generateEntryId(): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).substring(2, 8);
	return `entry_${timestamp}_${random}`;
}

/**
 * Generate a session ID.
 */
function generateSessionId(): string {
	const timestamp = Date.now().toString(36);
	return `session_${timestamp}`;
}

/**
 * Create a new diary entry.
 *
 * @param type - Entry type.
 * @param title - Entry title.
 * @param content - Entry content.
 * @param options - Additional entry options.
 * @returns Created diary entry.
 */
export async function createEntry(
	type: DiaryEntryType,
	title: string,
	content: string,
	options: {
		tags?: string[];
		sessionId?: string;
		accomplishments?: string[];
		challenges?: string[];
		nextSteps?: string[];
		config?: Partial<DiaryConfig>;
	} = {},
): Promise<DiaryEntry> {
	await ensureDiaryDir();

	const { tags = [], sessionId, accomplishments = [], challenges = [], nextSteps = [] } = options;

	const config = { ...DEFAULT_DIARY_CONFIG, ...options.config };

	const entry: DiaryEntry = {
		id: generateEntryId(),
		type,
		title,
		content,
		createdAt: new Date(),
		sessionId,
		tags,
		relatedMemories: [],
		accomplishments,
		challenges,
		nextSteps,
	};

	// Create a memory for this entry
	const memoryText = `[${type}] ${title}\n\n${content}`;
	const memoryEmbedding = await embed(memoryText);

	const memory = await addMemory({
		text: memoryText,
		embedding: memoryEmbedding,
		wing: config.wing,
		room: `${config.roomPrefix}/${type}`,
		source: `diary:${entry.id}`,
	});

	entry.relatedMemories.push(String(memory.id));

	// Save entry to file
	const entryPath = path.join(getDiaryPath(), `${entry.id}.json`);
	await fs.writeFile(entryPath, JSON.stringify(entry, null, 2), "utf-8");

	logger.debug("Diary entry created", { id: entry.id, type });

	return entry;
}

/**
 * Create a session start entry.
 */
export async function startSession(options?: {
	config?: Partial<DiaryConfig>;
}): Promise<{ session: Session; entry: DiaryEntry }> {
	const sessionId = generateSessionId();

	const session: Session = {
		id: sessionId,
		startedAt: new Date(),
		endedAt: null,
		memoryCount: 0,
		summary: "",
		actions: [],
		files: [],
		commands: [],
	};

	const entry = await createEntry("session_start", "Session Started", `New session ${sessionId} started.`, {
		sessionId,
		tags: ["session"],
		config: options?.config,
	});

	// Save session state
	await saveSessionState(session);

	return { session, entry };
}

/**
 * End a session and create summary.
 */
export async function endSession(
	sessionId: string,
	options: {
		summary?: string;
		accomplishments?: string[];
		challenges?: string[];
		nextSteps?: string[];
		config?: Partial<DiaryConfig>;
	} = {},
): Promise<{ session: Session; entry: DiaryEntry }> {
	const session = await loadSessionState(sessionId);

	if (!session) {
		throw new Error(`Session not found: ${sessionId}`);
	}

	session.endedAt = new Date();

	if (options.summary) {
		session.summary = options.summary;
	}

	// Create session end entry
	const entry = await createEntry("session_end", "Session Ended", options.summary ?? session.summary, {
		sessionId,
		tags: ["session", "summary"],
		accomplishments: options.accomplishments ?? [],
		challenges: options.challenges ?? [],
		nextSteps: options.nextSteps ?? [],
		config: options.config,
	});

	// Update and save session
	await saveSessionState(session);

	return { session, entry };
}

/**
 * Create a daily summary.
 */
export async function createDailySummary(
	date: string,
	options: {
		accomplishments?: string[];
		challenges?: string[];
		sentiment?: DailySummary["sentiment"];
		config?: Partial<DiaryConfig>;
	} = {},
): Promise<DailySummary> {
	const config = { ...DEFAULT_DIARY_CONFIG, ...options.config };

	// Count sessions and memories for this date
	const sessions = await getSessionsForDate(date);
	const memories = await getMemoriesForDate(date);

	const summary: DailySummary = {
		date,
		sessionCount: sessions.length,
		memoryCount: memories.length,
		activeWings: [...new Set(memories.map(m => m.wing))],
		accomplishments: options.accomplishments ?? [],
		challenges: options.challenges ?? [],
		sentiment: options.sentiment ?? "neutral",
		summary: "",
	};

	// Generate summary text
	const lines = [
		`Daily Summary for ${date}`,
		"",
		`Sessions: ${summary.sessionCount}`,
		`Memories created: ${summary.memoryCount}`,
		`Active wings: ${summary.activeWings.join(", ") || "none"}`,
		"",
	];

	if (summary.accomplishments.length > 0) {
		lines.push("Accomplishments:");
		for (const acc of summary.accomplishments) {
			lines.push(`  - ${acc}`);
		}
		lines.push("");
	}

	if (summary.challenges.length > 0) {
		lines.push("Challenges:");
		for (const chal of summary.challenges) {
			lines.push(`  - ${chal}`);
		}
		lines.push("");
	}

	lines.push(`Overall: ${summary.sentiment}`);

	summary.summary = lines.join("\n");

	// Create diary entry for the summary
	await createEntry("daily_summary", `Daily Summary: ${date}`, summary.summary, {
		tags: ["daily", "summary", date],
		accomplishments: summary.accomplishments,
		challenges: summary.challenges,
		config,
	});

	return summary;
}

/**
 * Create a reflection entry.
 */
export async function createReflection(
	content: string,
	options: {
		topic?: string;
		tags?: string[];
		accomplishments?: string[];
		challenges?: string[];
		nextSteps?: string[];
		config?: Partial<DiaryConfig>;
	} = {},
): Promise<DiaryEntry> {
	const title = options.topic ?? "Reflection";

	return createEntry("reflection", title, content, {
		tags: ["reflection", ...(options.tags ?? [])],
		accomplishments: options.accomplishments,
		challenges: options.challenges,
		nextSteps: options.nextSteps,
		config: options.config,
	});
}

/**
 * Record a milestone.
 */
export async function recordMilestone(
	title: string,
	description: string,
	options?: {
		tags?: string[];
		config?: Partial<DiaryConfig>;
	},
): Promise<DiaryEntry> {
	return createEntry("milestone", title, description, {
		tags: ["milestone", ...(options?.tags ?? [])],
		config: options?.config,
	});
}

/**
 * Load diary state.
 */
async function loadDiaryState(): Promise<{
	sessions: Map<string, Session>;
	activeSession: string | null;
}> {
	const statePath = getDiaryStatePath();

	try {
		const content = await fs.readFile(statePath, "utf-8");
		const data = JSON.parse(content);

		const sessions = new Map<string, Session>();
		for (const [id, session] of Object.entries(data.sessions ?? {})) {
			const s = session as Session;
			s.startedAt = new Date(s.startedAt);
			if (s.endedAt) {
				s.endedAt = new Date(s.endedAt);
			}
			sessions.set(id, s);
		}

		return {
			sessions,
			activeSession: data.activeSession ?? null,
		};
	} catch {
		return { sessions: new Map(), activeSession: null };
	}
}

/**
 * Save diary state.
 */
async function saveDiaryState(state: { sessions: Map<string, Session>; activeSession: string | null }): Promise<void> {
	await ensureDiaryDir();

	const data = {
		sessions: Object.fromEntries(state.sessions),
		activeSession: state.activeSession,
	};

	await fs.writeFile(getDiaryStatePath(), JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Load session state.
 */
async function loadSessionState(sessionId: string): Promise<Session | null> {
	const { sessions } = await loadDiaryState();
	return sessions.get(sessionId) ?? null;
}

/**
 * Save session state.
 */
async function saveSessionState(session: Session): Promise<void> {
	const state = await loadDiaryState();
	state.sessions.set(session.id, session);
	await saveDiaryState(state);
}

/**
 * Get active session.
 */
export async function getActiveSession(): Promise<Session | null> {
	const { sessions, activeSession } = await loadDiaryState();

	if (!activeSession) return null;
	return sessions.get(activeSession) ?? null;
}

/**
 * Get sessions for a specific date.
 */
async function getSessionsForDate(date: string): Promise<Session[]> {
	const { sessions } = await loadDiaryState();

	const sessionsArray = Array.from(sessions.values());
	const dateStart = new Date(date);
	const dateEnd = new Date(date);
	dateEnd.setDate(dateEnd.getDate() + 1);

	return sessionsArray.filter(s => {
		const start = s.startedAt.getTime();
		return start >= dateStart.getTime() && start < dateEnd.getTime();
	});
}

/**
 * Get memories for a specific date.
 */
async function getMemoriesForDate(date: string): Promise<Array<{ wing: string }>> {
	const { listMemories } = await import("../memory");

	const dateStart = new Date(date);
	const dateEnd = new Date(date);
	dateEnd.setDate(dateEnd.getDate() + 1);

	const memories = await listMemories({ wing: "diary", limit: 1000 });

	return memories
		.filter(m => {
			const time = m.timestamp.getTime();
			return time >= dateStart.getTime() && time < dateEnd.getTime();
		})
		.map(m => ({ wing: m.wing }));
}

/**
 * Get recent diary entries.
 */
export async function getRecentEntries(limit = 10): Promise<DiaryEntry[]> {
	await ensureDiaryDir();

	const diaryPath = getDiaryPath();
	const files = await fs.readdir(diaryPath);

	const entries: DiaryEntry[] = [];

	for (const file of files) {
		if (!file.endsWith(".json") || file === "state.json") continue;

		try {
			const content = await fs.readFile(path.join(diaryPath, file), "utf-8");
			const entry = JSON.parse(content) as DiaryEntry;
			entry.createdAt = new Date(entry.createdAt);
			entries.push(entry);
		} catch {
			// Skip invalid entries
		}
	}

	// Sort by date descending
	entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

	return entries.slice(0, limit);
}

/**
 * Get diary statistics.
 */
export async function getDiaryStats(): Promise<{
	totalEntries: number;
	entriesByType: Record<DiaryEntryType, number>;
	totalSessions: number;
	dateRange: { start: Date | null; end: Date | null };
}> {
	const entries = await getRecentEntries(10000);

	const entriesByType: Record<DiaryEntryType, number> = {
		session_start: 0,
		session_end: 0,
		daily_summary: 0,
		reflection: 0,
		milestone: 0,
		note: 0,
	};

	for (const entry of entries) {
		entriesByType[entry.type]++;
	}

	const { sessions } = await loadDiaryState();

	const dates = entries.map(e => e.createdAt);
	const startDate = dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : null;
	const endDate = dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : null;

	return {
		totalEntries: entries.length,
		entriesByType,
		totalSessions: sessions.size,
		dateRange: { start: startDate, end: endDate },
	};
}
