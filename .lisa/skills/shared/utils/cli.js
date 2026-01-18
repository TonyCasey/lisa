"use strict";
/**
 * CLI argument parsing utilities.
 * Provides functions for parsing command-line arguments in skill scripts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.popFlag = popFlag;
exports.hasFlag = hasFlag;
exports.parseArgs = parseArgs;
exports.getFlag = getFlag;
exports.hasArgFlag = hasArgFlag;
function popFlag(args, name, fallback) {
    const idx = args.indexOf(name);
    if (idx === -1)
        return fallback;
    const val = args[idx + 1];
    args.splice(idx, 2);
    return val ?? fallback;
}
/**
 * Check if a boolean flag is present and remove it from args.
 * Mutates the args array by removing the flag.
 *
 * @param args - The arguments array to modify
 * @param name - The flag name (e.g., '--cache')
 * @returns True if flag was present
 */
function hasFlag(args, name) {
    const idx = args.indexOf(name);
    if (idx === -1)
        return false;
    args.splice(idx, 1);
    return true;
}
/**
 * Parse all arguments into a structured format.
 * Does not mutate the input array.
 *
 * @param argv - Raw arguments (typically process.argv.slice(2))
 * @returns Parsed arguments structure
 */
function parseArgs(argv) {
    const args = [...argv]; // Clone to avoid mutation
    const flags = new Map();
    // Extract all flags first
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const flagName = arg;
            args.splice(i, 1);
            // Check if next arg is a value (not another flag)
            if (i < args.length && !args[i].startsWith('--')) {
                flags.set(flagName, args[i]);
                args.splice(i, 1);
            }
            else {
                flags.set(flagName, true);
            }
        }
        else {
            i++;
        }
    }
    // First remaining arg is command, rest is payload
    const command = args.shift() ?? '';
    const payload = args.join(' ').trim();
    return { command, payload, flags };
}
function getFlag(flags, name, fallback) {
    const val = flags.get(name);
    if (val === undefined)
        return fallback;
    if (val === true)
        return fallback; // Boolean flag, no value
    return val;
}
/**
 * Check if a boolean flag is set in parsed args.
 *
 * @param flags - The flags map from parseArgs
 * @param name - The flag name (e.g., '--cache')
 */
function hasArgFlag(flags, name) {
    return flags.has(name);
}
//# sourceMappingURL=cli.js.map