/**
 * facts.ts - Generate and store facts from analysis
 *
 * Creates memory facts from scan analysis and stores them
 * at the parent group level for cross-repo knowledge.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import { IAnalysisResult } from './analyzer';

export interface IFact {
  text: string;
  type: 'solution-map' | 'project-summary' | 'dependency' | 'shared-stack' | 'pattern';
  tags?: string[];
}

export interface IStorageResult {
  success: boolean;
  factsStored: number;
  factsMerged: number;
  errors: string[];
}

/**
 * Normalize path to group ID (matches memory.js implementation)
 */
function normalizePathToGroupId(absolutePath: string): string {
  let normalized = absolutePath
    .toLowerCase()
    .replace(/^[a-z]:/i, (match) => match.charAt(0))
    .replace(/^\//, '')
    .replace(/\\/g, '-')
    .replace(/\//g, '-')
    .replace(/\./g, '_')
    .replace(/^-+/, '')
    .replace(/-+/g, '-');

  if (normalized.length > 128) {
    normalized = normalized.slice(-128);
  }
  return normalized;
}

/**
 * Generate facts from analysis result
 */
export function generateFacts(analysis: IAnalysisResult, _rootPath: string): IFact[] {
  const facts: IFact[] = [];
  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // 1. Solution overview fact
  facts.push({
    text: `SCAN [${timestamp}]: ${analysis.solutionOverview}`,
    type: 'solution-map',
    tags: ['type:solution-map', 'scope:scan'],
  });

  // 2. Individual project summary facts
  for (const project of analysis.projectSummaries) {
    const parts: string[] = [];
    parts.push(`${project.name}: ${project.language}`);
    if (project.framework) parts.push(project.framework);
    if (project.architecture) parts.push(`${project.architecture} architecture`);
    parts.push(`${project.fileCount} files`);

    facts.push({
      text: `PROJECT [${timestamp}]: ${parts.join(', ')}. ${project.summary}`,
      type: 'project-summary',
      tags: ['type:project-summary', `repo:${project.name}`, 'scope:scan'],
    });
  }

  // 3. Dependency facts
  const dependsOnRelationships = analysis.relationships.filter(r => r.type === 'depends_on');
  for (const rel of dependsOnRelationships) {
    facts.push({
      text: `DEPENDENCY [${timestamp}]: ${rel.description}`,
      type: 'dependency',
      tags: ['type:dependency', 'scope:scan'],
    });
  }

  // 4. Shared stack fact
  if (analysis.sharedStack.languages.length > 0 || analysis.sharedStack.frameworks.length > 0) {
    const stackParts: string[] = [];
    if (analysis.sharedStack.languages.length > 0) {
      stackParts.push(`Languages: ${analysis.sharedStack.languages.join(', ')}`);
    }
    if (analysis.sharedStack.frameworks.length > 0) {
      stackParts.push(`Frameworks: ${analysis.sharedStack.frameworks.join(', ')}`);
    }
    if (analysis.sharedStack.buildTools.length > 0) {
      stackParts.push(`Build: ${analysis.sharedStack.buildTools.join(', ')}`);
    }
    if (analysis.sharedStack.testingFrameworks.length > 0) {
      stackParts.push(`Testing: ${analysis.sharedStack.testingFrameworks.join(', ')}`);
    }

    facts.push({
      text: `SHARED-STACK [${timestamp}]: ${stackParts.join('. ')}`,
      type: 'shared-stack',
      tags: ['type:shared-stack', 'scope:scan'],
    });
  }

  // 5. Common pattern facts
  for (const arch of analysis.commonPatterns.architecture) {
    facts.push({
      text: `PATTERN [${timestamp}]: ${arch.projects.join(', ')} use ${arch.pattern} architecture`,
      type: 'pattern',
      tags: ['type:pattern', `pattern:${arch.pattern}`, 'scope:scan'],
    });
  }

  return facts;
}

/**
 * Find the memory script path
 */
async function findMemoryScript(rootPath: string): Promise<string | null> {
  const possiblePaths = [
    path.join(rootPath, '.lisa', 'skills', 'memory', 'scripts', 'memory.js'),
    path.join(rootPath, '.claude', 'skills', 'memory', 'scripts', 'memory.js'),
    path.join(__dirname, '..', '..', 'project', '.lisa', 'skills', 'memory', 'scripts', 'memory.js'),
  ];

  for (const p of possiblePaths) {
    if (await fs.pathExists(p)) {
      return p;
    }
  }
  return null;
}

/**
 * Store a single fact using the memory script
 */
async function storeFact(
  memoryScript: string,
  fact: IFact,
  groupId: string
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const args = [
      memoryScript,
      'add',
      fact.text,
      '--group', groupId,
      '--type', fact.type,
      '--cache',
    ];

    // Add tags
    if (fact.tags && fact.tags.length > 0) {
      for (const tag of fact.tags) {
        args.push('--tag', tag);
      }
    }

    const child = spawn('node', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          if (result.status === 'ok') {
            resolve({ success: true });
            return;
          }
        } catch {
          // Parse error but process succeeded
          resolve({ success: true });
          return;
        }
      }
      resolve({
        success: false,
        error: stderr || stdout || `Exit code ${code}`,
      });
    });

    child.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Store all facts to the parent group
 */
export async function storeFacts(
  facts: IFact[],
  rootPath: string,
  onProgress?: (current: number, total: number, fact: IFact) => void
): Promise<IStorageResult> {
  const result: IStorageResult = {
    success: true,
    factsStored: 0,
    factsMerged: 0,
    errors: [],
  };

  // Find memory script
  const memoryScript = await findMemoryScript(rootPath);
  if (!memoryScript) {
    result.success = false;
    result.errors.push('Memory script not found. Run lisa init first.');
    return result;
  }

  // Get parent group ID
  const groupId = normalizePathToGroupId(rootPath);

  // Store each fact
  for (let i = 0; i < facts.length; i++) {
    const fact = facts[i];

    if (onProgress) {
      onProgress(i + 1, facts.length, fact);
    }

    const storeResult = await storeFact(memoryScript, fact, groupId);

    if (storeResult.success) {
      result.factsStored++;
    } else {
      result.errors.push(`Failed to store "${fact.text.slice(0, 50)}...": ${storeResult.error}`);
    }
  }

  result.success = result.errors.length === 0;
  return result;
}

/**
 * Delete existing scan facts before storing new ones (for --clean flag)
 * Note: This is a simple implementation - in production you might want
 * to query and delete specific facts
 */
export async function cleanScanFacts(_rootPath: string): Promise<boolean> {
  // For now, we'll just return true - cleaning would require
  // querying existing facts with scope:scan tag and deleting them
  // This can be implemented when Graphiti supports deletion
  return true;
}
