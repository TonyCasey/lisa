/**
 * Stdin utilities for Claude Code hooks.
 */

export interface IHookInput {
  trigger?: 'startup' | 'resume' | 'compact' | 'clear';
  session_type?: 'startup' | 'resume' | 'compact' | 'clear';
}

/**
 * Read hook input from stdin (JSON with trigger type and session info).
 * Times out after 100ms if no input (for manual testing).
 */
export async function readStdin(): Promise<IHookInput> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    
    process.stdin.on('readable', () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });
    
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data) as IHookInput);
      } catch {
        resolve({});
      }
    });
    
    // Timeout if no stdin after 100ms (for manual testing)
    setTimeout(() => {
      if (!data) resolve({});
    }, 100);
  });
}
