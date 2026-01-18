#!/usr/bin/env node
"use strict";
/**
 * Compile Skills CLI - thin entry point.
 *
 * Merges SKILL.local.md extensions with base SKILL.md files.
 *
 * Usage: node compile-skills.js [--dir <skills-dir>]
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
async function main() {
    const { createSkillCompilerService } = await Promise.resolve().then(() => __importStar(require('../../shared/services')));
    const service = createSkillCompilerService();
    // Parse --dir argument
    const args = process.argv.slice(2);
    let skillsDir = path_1.default.join(process.cwd(), '.lisa', 'skills');
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--dir' && args[i + 1]) {
            skillsDir = path_1.default.resolve(args[i + 1]);
            i++;
        }
    }
    const result = service.compile(skillsDir);
    console.log(JSON.stringify(result, null, 2));
    // Human-readable summary
    if (result.results.length === 0) {
        console.error('No SKILL.local.md files found.');
    }
    else {
        console.error(`\nCompiled ${result.merged} skill(s), skipped ${result.skipped}, errors ${result.errors}`);
        for (const r of result.results) {
            const icon = r.status === 'merged' ? '✓' : r.status === 'skipped' ? '⊘' : '✗';
            console.error(`  ${icon} ${r.skill}: ${r.message}`);
        }
    }
}
main();
//# sourceMappingURL=compile-skills.js.map