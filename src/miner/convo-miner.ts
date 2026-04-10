/**
 * Conversation mining for MemPalace.
 *
 * Chunks conversation text by exchange pairs, detects rooms
 * from content, and stores memories in SurrealDB.
 */

import { logger } from "../logger";
import { addMemories } from "../memory";
import { embedBatch } from "../embed";
import { chunkConversation, chunkByParagraphs } from "./chunker";
import { detectConversationRoom, type RoomConfig } from "./room-detector";
import { assignWing, type WingConfig } from "./wing-router";
import type { MemoryInput, Embedding } from "../types";

/** Conversation mining options */
export interface ConvoMinerOptions {
	/** The conversation text to mine */
	text: string;
	/** Wing assignment */
	wing?: string;
	/** Room taxonomy */
	rooms?: RoomConfig[];
	/** Wing taxonomy */
	wings?: WingConfig[];
	/** Source identifier */
	source?: string;
	/** Minimum exchange length to consider valid */
	minExchangeLength?: number;
	/** Chunking mode */
	mode?: "exchanges" | "paragraphs";
}

/** Conversation mining result */
export interface ConvoMiningResult {
	/** Total exchanges/chunks found */
	exchangesFound: number;
	/** Chunks created */
	chunksCreated: number;
	/** Memories stored */
	memoriesStored: number;
	/** Detected room */
	detectedRoom: string;
	/** Assigned wing */
	assignedWing: string;
	/** Errors encountered */
	errors: Array<{ exchange: number; error: string }>;
}

/**
 * Mine a conversation.
 *
 * Parses the conversation into Q+A exchange pairs or paragraphs,
 * detects the appropriate room, and stores memories.
 *
 * @param options - Mining options.
 * @returns Mining result with statistics.
 */
export async function mineConversation(options: ConvoMinerOptions): Promise<ConvoMiningResult> {
	const {
		text,
		wing: explicitWing,
		rooms = [],
		wings = [],
		source = "conversation",
		minExchangeLength = 10,
		mode = "exchanges",
	} = options;

	logger.debug("Starting conversation mining", { source, mode });

	// Chunk based on mode
	let chunks: ReturnType<typeof chunkConversation> | ReturnType<typeof chunkByParagraphs>;
	if (mode === "exchanges") {
		chunks = chunkConversation(text, source);
	} else {
		chunks = chunkByParagraphs(text, source);
	}

	// Filter by minimum length
	chunks = chunks.filter(c => c.text.length >= minExchangeLength);

	if (chunks.length === 0) {
		logger.warn("No valid exchanges found", { source });
		return {
			exchangesFound: 0,
			chunksCreated: 0,
			memoriesStored: 0,
			detectedRoom: "general",
			assignedWing: explicitWing ?? "default",
			errors: [],
		};
	}

	// Detect room from full conversation
	const roomDetection = detectConversationRoom(text, rooms);

	// Get wing from conversation context
	const wingAssignment = explicitWing ?? assignWing(source, {}, wings).wing;

	// Generate embeddings in batch
	const texts = chunks.map(c => c.text);
	let embeddings: Embedding[];

	try {
		embeddings = await embedBatch(texts);
	} catch (err) {
		logger.error("Conversation embedding failed", {
			error: String(err),
			source,
		});
		return {
			exchangesFound: chunks.length,
			chunksCreated: 0,
			memoriesStored: 0,
			detectedRoom: roomDetection.room,
			assignedWing: wingAssignment,
			errors: [{ exchange: -1, error: String(err) }],
		};
	}

	// Create memory inputs
	const memories: MemoryInput[] = chunks.map((chunk, i) => ({
		text: chunk.text,
		embedding: embeddings[i],
		wing: wingAssignment,
		room: roomDetection.room,
		source: `${source}:exchange:${chunk.index}`,
	}));

	// Store in database
	let memoriesStored = 0;
	const errors: Array<{ exchange: number; error: string }> = [];

	try {
		const created = await addMemories(memories);
		memoriesStored = created.length;
	} catch (err) {
		logger.error("Failed to store conversation memories", {
			error: String(err),
			source,
		});
		errors.push({ exchange: -1, error: String(err) });
	}

	logger.info("Conversation mining complete", {
		exchangesFound: chunks.length,
		memoriesStored,
		room: roomDetection.room,
		wing: wingAssignment,
	});

	return {
		exchangesFound: chunks.length,
		chunksCreated: chunks.length,
		memoriesStored,
		detectedRoom: roomDetection.room,
		assignedWing: wingAssignment,
		errors,
	};
}

/**
 * Parse a conversation transcript into structured format.
 *
 * Supports multiple input formats:
 * - Plain text with speaker labels
 * - JSON with message objects
 * - Markdown with alternating sections
 */
export interface ParsedMessage {
	/** Speaker/role identifier */
	speaker: string;
	/** Message content */
	content: string;
	/** Timestamp if available */
	timestamp?: string;
	/** Index in original transcript */
	index: number;
}

/** Supported conversation formats */
export type ConversationFormat = "plain" | "json" | "markdown" | "auto";

/**
 * Parse conversation text into structured messages.
 *
 * @param text - The conversation text.
 * @param format - Expected format (auto-detects if not specified).
 * @returns Array of parsed messages.
 */
export function parseConversation(text: string, format: ConversationFormat = "auto"): ParsedMessage[] {
	if (format === "auto") {
		const detectedFormat = detectConversationFormat(text);
		return parseConversation(text, detectedFormat);
	}

	switch (format) {
		case "json":
			return parseJsonConversation(text);
		case "markdown":
			return parseMarkdownConversation(text);
		default:
			return parsePlainConversation(text);
	}
}

/**
 * Detect conversation format from content.
 */
function detectConversationFormat(text: string): ConversationFormat {
	const trimmed = text.trim();

	// Check for JSON array
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		try {
			JSON.parse(trimmed);
			return "json";
		} catch {
			// Not valid JSON
		}
	}

	// Check for markdown structure
	if (/^#{1,3}\s+\w+/.test(trimmed) || /^```/.test(trimmed)) {
		return "markdown";
	}

	return "plain";
}

/**
 * Parse JSON conversation format.
 */
function parseJsonConversation(text: string): ParsedMessage[] {
	try {
		const data = JSON.parse(text);
		const messages: ParsedMessage[] = [];

		if (Array.isArray(data)) {
			for (let i = 0; i < data.length; i++) {
				const item = data[i];
				if (typeof item === "object" && item !== null) {
					messages.push({
						speaker: (item.speaker as string) ?? (item.role as string) ?? (item.author as string) ?? "unknown",
						content: (item.content as string) ?? (item.text as string) ?? "",
						timestamp: item.timestamp as string | undefined,
						index: i,
					});
				}
			}
		} else if (typeof data === "object" && data !== null) {
			// Single message or message object
			messages.push({
				speaker: (data.speaker as string) ?? (data.role as string) ?? "unknown",
				content: (data.content as string) ?? (data.text as string) ?? "",
				timestamp: data.timestamp as string | undefined,
				index: 0,
			});
		}

		return messages;
	} catch (err) {
		logger.warn("JSON parse failed, falling back to plain", { error: String(err) });
		return parsePlainConversation(text);
	}
}

/**
 * Parse markdown conversation format.
 */
function parseMarkdownConversation(text: string): ParsedMessage[] {
	const messages: ParsedMessage[] = [];
	const lines = text.split("\n");
	let currentSpeaker = "";
	let currentContent = "";
	let index = 0;
	let inCodeBlock = false;

	for (const line of lines) {
		// Track code blocks
		if (line.trim().startsWith("```")) {
			inCodeBlock = !inCodeBlock;
			continue;
		}

		if (inCodeBlock) continue;

		// Check for heading (speaker marker)
		const headingMatch = line.match(/^#{1,3}\s+(.+)/);
		if (headingMatch) {
			// Save previous message
			if (currentContent.trim()) {
				messages.push({
					speaker: currentSpeaker || "unknown",
					content: currentContent.trim(),
					index: index++,
				});
			}
			currentSpeaker = headingMatch[1].trim();
			currentContent = "";
			continue;
		}

		// Check for speaker prefix
		const speakerMatch = line.match(/^\*\*(.+?):?\*\*\s*/);
		if (speakerMatch) {
			if (currentContent.trim()) {
				messages.push({
					speaker: currentSpeaker || "unknown",
					content: currentContent.trim(),
					index: index++,
				});
			}
			currentSpeaker = speakerMatch[1].trim();
			currentContent = line.slice(speakerMatch[0].length);
			continue;
		}

		// Check for timestamp prefix
		const timestampMatch = line.match(/^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/);
		if (timestampMatch) {
			const content = line.slice(timestampMatch[0].length);
			if (content.includes(":")) {
				const parts = content.split(":");
				if (parts.length >= 2 && currentSpeaker === "") {
					if (currentContent.trim()) {
						messages.push({
							speaker: currentSpeaker || "unknown",
							content: currentContent.trim(),
							index: index++,
						});
					}
					currentSpeaker = parts[0].trim();
					currentContent = parts.slice(1).join(":").trim();
					continue;
				}
			}
			currentContent += `\n${content}`;
			continue;
		}

		// Regular line
		if (currentSpeaker !== "" || currentContent !== "") {
			currentContent += `\n${line}`;
		}
	}

	// Don't forget the last message
	if (currentContent.trim()) {
		messages.push({
			speaker: currentSpeaker || "unknown",
			content: currentContent.trim(),
			index: index,
		});
	}

	return messages;
}

/**
 * Parse plain text conversation format.
 */
function parsePlainConversation(text: string): ParsedMessage[] {
	const messages: ParsedMessage[] = [];
	const lines = text.split("\n");

	let currentSpeaker = "";
	let currentContent = "";
	let index = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();

		// Check for speaker change
		const speakerMatch =
			trimmed.match(/^(user|human|me|my|i)\s*:\s*/i) ||
			trimmed.match(/^(assistant|ai|bot|agent|system)\s*:\s*/i) ||
			trimmed.match(/^([A-Za-z][a-z]*)\s*:\s*/);

		if (speakerMatch) {
			// Save previous message
			if (currentContent.trim()) {
				messages.push({
					speaker: currentSpeaker,
					content: currentContent.trim(),
					index: index++,
				});
			}

			currentSpeaker = speakerMatch[1].toLowerCase();
			currentContent = trimmed.slice(speakerMatch[0].length);
			continue;
		}

		// Check for empty line (conversation break)
		if (trimmed === "" && currentContent.length > 0) {
			// Check if next non-empty line is a question (new exchange)
			let nextNonEmpty = -1;
			for (let j = i + 1; j < lines.length; j++) {
				if (lines[j].trim() !== "") {
					nextNonEmpty = j;
					break;
				}
			}

			if (nextNonEmpty !== -1) {
				const nextLine = lines[nextNonEmpty].trim();
				// If next line starts with a question or is a response
				const isNewExchange =
					/^[A-Z][^.!?]*[?]$/.test(nextLine) ||
					/^(yes|no|ok|okay|sure|indeed|certainly)/i.test(nextLine) ||
					/^(what|who|where|when|why|how|can|could|would|should)/i.test(nextLine);

				if (isNewExchange && currentContent.length > 20) {
					messages.push({
						speaker: currentSpeaker || "unknown",
						content: currentContent.trim(),
						index: index++,
					});
					currentSpeaker = "";
					currentContent = "";
				}
			}
			continue;
		}

		// Regular content line
		if (currentSpeaker !== "" || trimmed !== "") {
			if (currentSpeaker === "" && trimmed !== "") {
				// First non-empty line without speaker
				currentSpeaker = "speaker";
			}
			currentContent += (currentContent ? "\n" : "") + trimmed;
		}
	}

	// Don't forget the last message
	if (currentContent.trim()) {
		messages.push({
			speaker: currentSpeaker || "unknown",
			content: currentContent.trim(),
			index: index,
		});
	}

	return messages;
}

/**
 * Build conversation text from parsed messages.
 *
 * Formats parsed messages back into a readable conversation format.
 */
export function formatConversation(messages: ParsedMessage[]): string {
	return messages.map(m => `**${m.speaker}:**\n${m.content}`).join("\n\n");
}
