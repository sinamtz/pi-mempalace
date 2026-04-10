/**
 * Text chunking logic for MemPalace mining pipeline.
 *
 * Chunks text by paragraph (blank-line separation) while respecting
 * configurable size limits. Used by both file mining and conversation mining.
 */

import { logger } from "../logger";

/** Default chunk configuration */
export const CHUNK_CONFIG = {
	/** Target number of characters per chunk */
	TARGET_CHUNK_SIZE: 512,
	/** Maximum characters per chunk (hard limit) */
	MAX_CHUNK_SIZE: 1024,
	/** Minimum characters for a valid chunk */
	MIN_CHUNK_SIZE: 10,
	/** Overlap between chunks in characters */
	CHUNK_OVERLAP: 64,
} as const;

/** A chunk of text with metadata */
export interface Chunk {
	/** The text content */
	text: string;
	/** Character offset in the original source */
	offset: number;
	/** Length of the chunk */
	length: number;
	/** Index of this chunk in the document */
	index: number;
	/** Source identifier */
	source: string;
}

/** Options for chunking operations */
export interface ChunkOptions {
	/** Target chunk size in characters */
	targetSize?: number;
	/** Maximum chunk size */
	maxSize?: number;
	/** Minimum chunk size */
	minSize?: number;
	/** Overlap between chunks */
	overlap?: number;
}

/**
 * Split text into paragraphs by blank line separation.
 *
 * A paragraph is a block of text separated by one or more blank lines
 * (lines containing only whitespace).
 *
 * @param text - The text to split into paragraphs.
 * @returns Array of paragraphs with their offsets.
 */
export function splitParagraphs(text: string): Array<{ text: string; offset: number }> {
	const paragraphs: Array<{ text: string; offset: number }> = [];
	let currentParagraph = "";
	let currentOffset = 0;

	for (const line of text.split("\n")) {
		const trimmedLine = line.trim();

		if (trimmedLine === "") {
			// Blank line - end current paragraph if non-empty
			if (currentParagraph.length > 0) {
				paragraphs.push({
					text: currentParagraph.trim(),
					offset: currentOffset,
				});
				currentParagraph = "";
			}
			// Update offset to track position in original text
			currentOffset = text.indexOf(line, currentOffset) + line.length + 1;
		} else {
			// Non-blank line - add to current paragraph
			if (currentParagraph.length === 0) {
				currentOffset = text.indexOf(line, currentOffset);
			}
			currentParagraph += (currentParagraph.length > 0 ? "\n" : "") + line;
		}
	}

	// Don't forget the last paragraph
	if (currentParagraph.trim().length > 0) {
		paragraphs.push({
			text: currentParagraph.trim(),
			offset: currentOffset,
		});
	}

	return paragraphs;
}

/**
 * Merge small paragraphs into the next chunk to avoid trivial fragments.
 *
 * @param paragraphs - Paragraphs to merge.
 * @param minSize - Minimum paragraph size to keep separate.
 * @returns Merged paragraphs.
 */
function mergeSmallParagraphs(
	paragraphs: Array<{ text: string; offset: number }>,
	minSize: number,
): Array<{ text: string; offset: number }> {
	if (paragraphs.length <= 1) return paragraphs;

	const merged: Array<{ text: string; offset: number }> = [];
	let current = paragraphs[0];

	for (let i = 1; i < paragraphs.length; i++) {
		const next = paragraphs[i];

		// If current is too small, merge with next
		if (current.text.length < minSize) {
			current = {
				text: `${current.text}\n${next.text}`,
				offset: current.offset,
			};
		} else {
			merged.push(current);
			current = next;
		}
	}

	merged.push(current);
	return merged;
}

/**
 * Chunk text by paragraphs, respecting size limits.
 *
 * Groups paragraphs together until the target chunk size is reached,
 * then starts a new chunk. Handles edge cases:
 * - Very long paragraphs are kept as-is even if over target size
 * - Small paragraphs are merged with neighbors to avoid fragments
 *
 * @param text - The text to chunk.
 * @param source - Source identifier for the chunks.
 * @param options - Chunking options.
 * @returns Array of chunks with metadata.
 */
export function chunkByParagraphs(text: string, source: string, options: ChunkOptions = {}): Chunk[] {
	const {
		targetSize = CHUNK_CONFIG.TARGET_CHUNK_SIZE,
		maxSize = CHUNK_CONFIG.MAX_CHUNK_SIZE,
		minSize = CHUNK_CONFIG.MIN_CHUNK_SIZE,
		overlap = CHUNK_CONFIG.CHUNK_OVERLAP,
	} = options;

	// Split into paragraphs
	let paragraphs = splitParagraphs(text);

	// Merge tiny paragraphs
	paragraphs = mergeSmallParagraphs(paragraphs, minSize);

	if (paragraphs.length === 0) {
		return [];
	}

	const chunks: Chunk[] = [];
	let currentChunk = "";
	let currentOffset = 0;
	let currentIndex = 0;

	for (let i = 0; i < paragraphs.length; i++) {
		const para = paragraphs[i];
		const paraLen = para.text.length;

		// Handle very long paragraphs
		if (paraLen > maxSize) {
			// Save current chunk if non-empty
			if (currentChunk.length >= minSize) {
				chunks.push({
					text: currentChunk.trim(),
					offset: currentOffset,
					length: currentChunk.trim().length,
					index: currentIndex++,
					source,
				});

				// Apply overlap by starting next chunk partway through previous content
				if (chunks.length > 0 && overlap > 0) {
					const lastChunk = chunks[chunks.length - 1].text;
					const overlapText = lastChunk.slice(-Math.min(overlap, lastChunk.length));
					currentChunk = `${overlapText}\n${para.text.slice(0, Math.floor(overlap / 2))}`;
					currentOffset = para.offset;
				} else {
					currentChunk = "";
					currentOffset = 0;
				}
			}

			// Split long paragraph into sub-chunks
			let start = 0;
			while (start < paraLen) {
				const end = Math.min(start + targetSize, paraLen);
				const subText = para.text.slice(start, end);

				chunks.push({
					text: subText.trim(),
					offset: para.offset + start,
					length: subText.trim().length,
					index: currentIndex++,
					source,
				});

				start = end - overlap;
				if (start < 0) start = end;
			}

			currentChunk = "";
			currentOffset = 0;
			continue;
		}

		// Check if adding this paragraph exceeds target
		if (currentChunk.length + paraLen > targetSize && currentChunk.length >= minSize) {
			// Save current chunk
			chunks.push({
				text: currentChunk.trim(),
				offset: currentOffset,
				length: currentChunk.trim().length,
				index: currentIndex++,
				source,
			});

			// Apply overlap
			if (overlap > 0 && currentChunk.length > overlap) {
				const overlapText = currentChunk.slice(-overlap);
				currentChunk = `${overlapText}\n${para.text}`;
				currentOffset = currentOffset + currentChunk.length - paraLen - overlap;
			} else {
				currentChunk = para.text;
				currentOffset = para.offset;
			}
		} else {
			// Add to current chunk
			if (currentChunk.length === 0) {
				currentChunk = para.text;
				currentOffset = para.offset;
			} else {
				currentChunk += `\n${para.text}`;
			}
		}
	}

	// Don't forget the last chunk
	if (currentChunk.trim().length >= minSize) {
		chunks.push({
			text: currentChunk.trim(),
			offset: currentOffset,
			length: currentChunk.trim().length,
			index: currentIndex,
			source,
		});
	}

	logger.debug("Text chunked", {
		source,
		originalLength: text.length,
		paragraphCount: paragraphs.length,
		chunkCount: chunks.length,
	});

	return chunks;
}

/**
 * Split conversation text into Q+A exchange pairs.
 *
 * Identifies question-answer pairs by looking for common question
 * indicators and response patterns. Returns each pair as a single chunk.
 *
 * @param text - The conversation text to split.
 * @param source - Source identifier.
 * @returns Array of conversation chunks.
 */
export function chunkConversation(text: string, source: string): Chunk[] {
	const exchanges = parseConversationPairs(text);

	return exchanges.map((exchange, index) => ({
		text: exchange.text.trim(),
		offset: exchange.offset,
		length: exchange.text.trim().length,
		index,
		source,
	}));
}

/** A parsed conversation pair */
interface ConversationPair {
	/** The combined Q+A text */
	text: string;
	/** Offset in the original text */
	offset: number;
}

/**
 * Parse conversation text into question-answer pairs.
 *
 * @param text - The conversation text.
 * @returns Array of conversation pairs.
 */
function parseConversationPairs(text: string): ConversationPair[] {
	const pairs: ConversationPair[] = [];
	const lines = text.split("\n");

	let currentPair = "";
	let currentOffset = 0;
	let inExchange = false;
	let _exchangeStart = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();

		// Detect start of new exchange (question or message)
		const isNewExchange = detectExchangeStart(trimmed, lines[i - 1]?.trim() ?? "");

		if (isNewExchange && inExchange && currentPair.trim().length > 0) {
			// Save previous pair
			pairs.push({
				text: currentPair.trim(),
				offset: currentOffset,
			});

			// Start new pair
			currentPair = trimmed;
			currentOffset = text.indexOf(line);
			_exchangeStart = currentOffset;
			inExchange = true;
		} else if (isNewExchange && !inExchange) {
			// First exchange
			currentPair = trimmed;
			currentOffset = text.indexOf(line);
			inExchange = true;
		} else if (inExchange) {
			// Continue current pair
			currentPair += `\n${trimmed}`;
		}
	}

	// Don't forget the last pair
	if (currentPair.trim().length > 0) {
		pairs.push({
			text: currentPair.trim(),
			offset: currentOffset,
		});
	}

	return pairs;
}

/**
 * Detect if a line marks the start of a new exchange.
 *
 * @param line - The current line.
 * @param prevLine - The previous line (for context).
 * @returns True if this line starts a new exchange.
 */
function detectExchangeStart(line: string, prevLine: string): boolean {
	if (line.length === 0) return false;

	// Empty previous line often indicates a new exchange
	if (prevLine.length === 0) return true;

	// Question indicators
	const questionPatterns = [
		/^[A-Z][^.!?]*[?]$/, // Ends with question mark
		/^(what|who|where|when|why|how|which|can|could|would|should|is|are|do|does|did)\s/i,
		/^(user|human|me|my|i)\s*:/i,
		/^(question|help|please|thanks|thank you)/i,
	];

	for (const pattern of questionPatterns) {
		if (pattern.test(line)) return true;
	}

	// Message separator patterns (timestamp, speaker change, etc.)
	const separatorPatterns = [
		/^\d{1,2}:\d{2}/, // Time
		/^\[\d{1,2}:\d{2}/, // Bracketed time
		/^(human|user|assistant|bot|ai|agent|system):\s*/i,
		/^---+$/, // Horizontal rule
	];

	for (const pattern of separatorPatterns) {
		if (pattern.test(line)) return true;
	}

	// If previous line was long and this is short, might be a new exchange
	if (prevLine.length > 80 && line.length < 80 && line.length > 0) {
		// Check for response patterns
		const responsePatterns = [
			/^[A-Z]/, // Starts with capital
			/^(yes|no|sure|okay|ok|indeed|certainly|absolutely|definitely)/i,
			/^(here|there|this|that|the|to|and|in|on|with|for|of|a|an)/i,
		];

		for (const pattern of responsePatterns) {
			if (pattern.test(line)) return true;
		}
	}

	return false;
}
