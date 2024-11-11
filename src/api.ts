import { requestUrl } from "obsidian";
import SharePlugin from "./main";
import StatusMessage, { StatusType } from "./StatusMessage";
import { sha1, sha256 } from "./crypto";
import NoteTemplate from "./NoteTemplate";
import { SharedUrl } from "./note";

const pluginVersion = require("../manifest.json").version;

export interface FileUpload {
  filetype: string;
  hash: string;
  content?: ArrayBuffer | string;
  byteLength: number;
  expiration?: number;
  url?: string | null;
}

export type PostData = {
  files?: FileUpload[];
  filename?: string;
  filetype?: string;
  hash?: string;
  byteLength?: number;
  expiration?: number;
  template?: NoteTemplate;
  debug?: number;
};

export interface UploadQueueItem {
  data: FileUpload;
  callback: (url: string) => void;
}

export interface CheckFilesResult {
  success: boolean;
  files: FileUpload[];
  css?: {
    url: string;
    hash: string;
  };
}

export default class API {
  plugin: SharePlugin;
  uploadQueue: UploadQueueItem[];

  constructor(plugin: SharePlugin) {
    this.plugin = plugin;
    this.uploadQueue = [];
  }
}

export function parseExistingShareUrl(url: string): SharedUrl | false {
  const match = url.match(/(\w+)(#.+?|)$/);
  if (match) {
    return {
      filename: match[1],
      decryptionKey: match[2].slice(1) || "",
      url,
    };
  }
  return false;
}
