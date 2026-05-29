export interface ZipEntry {
  path: string;
  name: string;
  dir: boolean;
}

export interface ZipTreeNode {
  name: string;
  path: string;
  dir: boolean;
  children: ZipTreeNode[];
  expanded?: boolean;
}

export interface ZipExplorerState {
  fileName: string;
  entries: ZipEntry[];
  tree: ZipTreeNode;
  selectedPath?: string;
  fileContent?: string;
}
