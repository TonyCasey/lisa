export interface ITemplateCopier {
  copy(
    templateRel: string,
    destAbs: string,
    replacements: Record<string, string>,
    force?: boolean,
  ): Promise<{ skipped: boolean }>;
}
