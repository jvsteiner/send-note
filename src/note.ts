import { CachedMetadata, requestUrl, TFile, View, WorkspaceLeaf } from "obsidian";
import { encryptString } from "./crypto";
import SharePlugin from "./main";
import StatusMessage, { StatusType } from "./StatusMessage";
import { ElementStyle } from "./NoteTemplate";
import { YamlField } from "./settings";
import { CheckFilesResult } from "./api";

export interface SharedUrl {
  filename: string;
  decryptionKey: string;
  url: string;
}

export interface SharedNote extends SharedUrl {
  file: TFile;
}

export interface PreviewSection {
  el: HTMLElement;
}

export interface Renderer {
  parsing: boolean;
  pusherEl: HTMLElement;
  previewEl: HTMLElement;
  sections: PreviewSection[];
}

export interface ViewModes extends View {
  getViewType: any;
  getDisplayText: any;
  modes: {
    preview: {
      renderer: Renderer;
    };
  };
}

export default class Note {
  plugin: SharePlugin;
  leaf: WorkspaceLeaf;
  status: StatusMessage;
  css: string;
  cssRules: CSSRule[];
  cssResult: CheckFilesResult["css"];
  contentDom: Document;
  meta: CachedMetadata | null;
  isEncrypted = true;
  isForceUpload = false;
  isForceClipboard = false;
  elements: ElementStyle[];
  expiration?: number;
  file: TFile;

  constructor(plugin: SharePlugin) {
    this.plugin = plugin;
    // .getLeaf() doesn't return a `previewMode` property when a note is pinned,
    // so use the undocumented .getActiveFileView() which seems to work fine
    // @ts-ignore
    this.leaf = this.plugin.app.workspace.getActiveFileView()?.leaf;
    this.elements = [];
    const aFile = this.plugin.app.workspace.getActiveFile();
    if (aFile instanceof TFile) {
      this.file = aFile;
    }
  }

  /**
   * Return the name (key) of a frontmatter property, eg 'share_link'
   * @param key
   * @return {string} The name (key) of a frontmatter property
   */
  field(key: YamlField): string {
    return this.plugin.field(key);
  }

  /**
   * Shares the current note by uploading its content to Pastebin and generating a shareable Obsidian URL.
   *
   * This method performs the following steps:
   * 1. Displays a status message indicating that the note is being processed.
   * 2. Reads the content of the current note.
   * 3. Encrypts the note content if the user has not opted to share unencrypted notes.
   * 4. Removes the "send_link" frontmatter from the note if it exists.
   * 5. Prepares the data required for the Pastebin API request.
   * 6. Sends the note content to Pastebin.
   * 7. Generates an Obsidian URL for the shared note.
   * 8. Copies the generated URL to the clipboard.
   * 9. Updates the note's frontmatter with the generated URL.
   * 10. Adds share icons to the note.
   *
   * @returns {Promise<void>} A promise that resolves when the note has been successfully shared.
   */
  async share() {
    // Create a semi-permanent status notice which we can update
    this.status = new StatusMessage(
      "If this message is showing, please do not change to another note as the current note data is still being parsed.",
      StatusType.Default,
      60 * 1000
    );

    let shareUnencrypted = this.plugin.settings.shareUnencrypted;
    let plainTextNoteContent = await this.plugin.app.vault.read(this.file);
    let noteContent = "";
    let encryptionKey = "";
    //encrypt note content
    if (shareUnencrypted) {
      // The user has opted to share unencrypted by default
      noteContent = plainTextNoteContent;
    } else {
      const encryptedNoteContent = await encryptString(plainTextNoteContent);
      noteContent = JSON.stringify(encryptedNoteContent.ciphertext);
      encryptionKey = encryptedNoteContent.key;
    }
    await this.plugin.app.fileManager.processFrontMatter(this.file, (frontmatter) => {
      if ((frontmatter["send_link"] = true)) {
        delete frontmatter["send_link"];
      }
    });

    const pastebinData = {
      api_dev_key: this.plugin.settings.pastebinApiKey,
      api_user_key: this.plugin.settings.pastebinUserKey,
      api_option: "paste",
      api_paste_private: 1,
      api_paste_name: this.file.basename,
      api_paste_expire_date: this.plugin.settings.pastebinExpiry,
      api_paste_format: "text",
      api_paste_code: encodeURIComponent(noteContent),
    };

    const body = createQueryString(pastebinData);

    requestUrl({
      url: "https://pastebin.com/api/api_post.php",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body,
    })
      .then((res) => {
        // console.log("res", res.text);
        const urlObj = new URL(res.text);
        // Get the pathname and split by "/"
        const pathSegments = urlObj.pathname.split("/");
        // The last segment will be the suffix
        const suffix = pathSegments[pathSegments.length - 1];
        let obsidianUrl = "";
        if (shareUnencrypted) {
          obsidianUrl = `obsidian://send-note?sendurl=https://pastebin.com/raw/${suffix}&filename=${this.file.basename}.md`;
        } else {
          obsidianUrl = `obsidian://send-note?sendurl=https://pastebin.com/raw/${suffix}&filename=${this.file.basename}.md&encrypted=true&key=${encryptionKey}`;
        }
        // console.log(obsidianUrl);
        navigator.clipboard.writeText(obsidianUrl);
        this.plugin.app.fileManager.processFrontMatter(this.file, (frontmatter) => {
          if ((frontmatter["send_link"] = true)) {
            frontmatter["send_link"] = obsidianUrl;
          }
        });
        this.plugin.addShareIcons();
      })
      .catch((err) => {
        console.log("err", err);
      });
    return;
  }

  /**
   * Finds the callout icon CSS rule and returns its value.
   * @param test - A function that takes a CSS selector text and returns a boolean indicating whether the rule matches the test.
   * @returns The value of the `--callout-icon` CSS property if a matching rule is found, otherwise an empty string.
   */
  getCalloutIcon(test: (selectorText: string) => boolean) {
    const rule = this.cssRules.find(
      (rule: CSSStyleRule) =>
        rule.selectorText && test(rule.selectorText) && rule.style.getPropertyValue("--callout-icon")
    ) as CSSStyleRule;
    if (rule) {
      return rule.style.getPropertyValue("--callout-icon");
    }
    return "";
  }

  /**
   * Reduces an array of HTML elements to a single string containing their outer HTML.
   * @param sections - An array of objects containing HTML elements.
   * @returns A string containing the concatenated outer HTML of all the elements in the input array.
   */
  reduceSections(sections: { el: HTMLElement }[]) {
    return sections.reduce((p: string, c) => p + c.el.outerHTML, "");
  }

  /**
   * Force all related assets to upload again
   */
  forceUpload() {
    this.isForceUpload = true;
  }

  /**
   * Copy the shared link to the clipboard, regardless of the user setting
   */
  forceClipboard() {
    this.isForceClipboard = true;
  }

  /**
   * Enables or disables encryption for the note.
   * @param isPlainText - Indicates whether the note should be shared as plain text (not encrypted).
   */
  shareAsPlainText(isPlainText: boolean) {
    this.isEncrypted = !isPlainText;
  }
}

function createQueryString(params: Record<string, string | number | boolean | null | undefined>): string {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      // Convert the value to string before appending
      searchParams.append(key, String(value));
    }
  });

  return searchParams.toString(); // This returns the query string e.g., 'key1=value1&key2=value2'
}
