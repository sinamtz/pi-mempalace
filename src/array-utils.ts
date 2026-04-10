/** Convert Float32Array to a SurrealDB-compatible array. */
export function toSurrealArray(embedding: Float32Array): number[] {
	return Array.from(embedding);
}

/** Convert SurrealDB array back to Float32Array. */
export function fromSurrealArray(arr: unknown[]): Float32Array {
	return Float32Array.from(arr as number[]);
}

/** Convert Float32Array to a SurrealDB string representation. */
export function toSurrealVector(embedding: Float32Array): string {
	return `[${Array.from(embedding).join(",")}]`;
}
