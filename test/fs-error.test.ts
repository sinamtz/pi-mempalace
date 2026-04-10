import { describe, expect, test } from "bun:test";
import { isEnoent, isEacces, isEexist } from "../src/fs-error";

describe("isEnoent", () => {
	test("returns true for Error with ENOENT code", () => {
		const error = new Error("file not found") as NodeJS.ErrnoException;
		error.code = "ENOENT";
		expect(isEnoent(error)).toBe(true);
	});

	test("returns false for Error with wrong code type (string comparison)", () => {
		const error = new Error("something") as NodeJS.ErrnoException;
		error.code = "enoent"; // lowercase — does not match
		expect(isEnoent(error)).toBe(false);
	});

	test("returns true for Error with message containing 'no such file or directory'", () => {
		const error = new Error("ENOENT: no such file or directory, stat '/path'");
		expect(isEnoent(error)).toBe(true);
	});

	test("returns false for Error with unrelated message", () => {
		const error = new Error("permission denied");
		expect(isEnoent(error)).toBe(false);
	});

	test("returns false for string", () => {
		expect(isEnoent("something went wrong")).toBe(false);
	});

	test("returns false for number", () => {
		expect(isEnoent(404)).toBe(false);
	});

	test("returns false for null", () => {
		expect(isEnoent(null)).toBe(false);
	});

	test("returns false for undefined", () => {
		expect(isEnoent(undefined)).toBe(false);
	});

	test("returns true for plain object with ENOENT code (not Error instance)", () => {
		expect(isEnoent({ code: "ENOENT" })).toBe(true);
	});

	test("returns false for object with wrong code", () => {
		expect(isEnoent({ code: "EACCES" })).toBe(false);
	});

	test("returns false for object without code property", () => {
		expect(isEnoent({ message: "file not found" })).toBe(false);
	});
});

describe("isEacces", () => {
	test("returns true for Error with EACCES code", () => {
		const error = new Error("permission denied") as NodeJS.ErrnoException;
		error.code = "EACCES";
		expect(isEacces(error)).toBe(true);
	});

	test("returns false for Error with wrong code type (string comparison)", () => {
		const error = new Error("permission denied") as NodeJS.ErrnoException;
		error.code = "eacces"; // lowercase — does not match
		expect(isEacces(error)).toBe(false);
	});

	test("returns false for Error with unrelated message", () => {
		const error = new Error("file not found");
		expect(isEacces(error)).toBe(false);
	});

	test("returns false for string", () => {
		expect(isEacces("permission denied")).toBe(false);
	});

	test("returns false for number", () => {
		expect(isEacces(403)).toBe(false);
	});

	test("returns false for null", () => {
		expect(isEacces(null)).toBe(false);
	});

	test("returns false for undefined", () => {
		expect(isEacces(undefined)).toBe(false);
	});

	test("returns true for plain object with EACCES code (not Error instance)", () => {
		expect(isEacces({ code: "EACCES" })).toBe(true);
	});

	test("returns false for object with wrong code", () => {
		expect(isEacces({ code: "ENOENT" })).toBe(false);
	});

	test("returns false for object without code property", () => {
		expect(isEacces({ message: "permission denied" })).toBe(false);
	});
});

describe("isEexist", () => {
	test("returns true for Error with EEXIST code", () => {
		const error = new Error("file already exists") as NodeJS.ErrnoException;
		error.code = "EEXIST";
		expect(isEexist(error)).toBe(true);
	});

	test("returns false for Error with wrong code type (string comparison)", () => {
		const error = new Error("file already exists") as NodeJS.ErrnoException;
		error.code = "eexist"; // lowercase — does not match
		expect(isEexist(error)).toBe(false);
	});

	test("returns false for Error with unrelated message", () => {
		const error = new Error("permission denied");
		expect(isEexist(error)).toBe(false);
	});

	test("returns false for string", () => {
		expect(isEexist("file already exists")).toBe(false);
	});

	test("returns false for number", () => {
		expect(isEexist(17)).toBe(false);
	});

	test("returns false for null", () => {
		expect(isEexist(null)).toBe(false);
	});

	test("returns false for undefined", () => {
		expect(isEexist(undefined)).toBe(false);
	});

	test("returns true for plain object with EEXIST code (not Error instance)", () => {
		expect(isEexist({ code: "EEXIST" })).toBe(true);
	});

	test("returns false for object with wrong code", () => {
		expect(isEexist({ code: "ENOENT" })).toBe(false);
	});

	test("returns false for object without code property", () => {
		expect(isEexist({ message: "file already exists" })).toBe(false);
	});
});
