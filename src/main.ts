import { Plugin, requestUrl, setIcon, TFile } from "obsidian";
import { DEFAULT_SETTINGS, SendNoteSettings, SendNoteSettingsTab, YamlField } from "./settings";
import Note, { SharedNote } from "./note";
import API, { parseExistingShareUrl } from "./api";
import StatusMessage, { StatusType } from "./StatusMessage";
import { shortHash, sha256, decryptString } from "./crypto";
import UI from "./UI";

export default class SendNotePlugin extends Plugin {
  settings: SendNoteSettings;
  api: API;
  settingsPage: SendNoteSettingsTab;
  ui: UI;

  // Expose some tools in the plugin object
  hash = shortHash;
  sha256 = sha256;

  async onload() {
    // Settings page
    await this.loadSettings();

    this.settingsPage = new SendNoteSettingsTab(this.app, this);
    this.addSettingTab(this.settingsPage);

    // Initialise the backend API
    this.ui = new UI(this.app);

    // To get an API key, we send the user to a Cloudflare Turnstile page to verify they are a human,
    // as a way to prevent abuse. The key is then sent back to Obsidian via this URI handler.
    // This way we do not require any personal data from the user like an email address.
    this.registerObsidianProtocolHandler("send-note", async (data) => {
      if (data.action === "send-note" && data.sendurl && data.filename) {
        let response = await requestUrl(data.sendurl);
        if (response.status === 200) {
          // check if file already exists
          let newFilename = data.filename;
          let noteContent = "";
          const file = this.app.vault.getAbstractFileByPath(data.filename);
          if (file) {
            newFilename = data.filename.replace(".md", "-" + this.generateRandomString() + ".md");
          } else {
            newFilename = data.filename;
          }
          if (data.encrypted && data.key) {
            noteContent = await decryptString({
              ciphertext: JSON.parse(decodeURIComponent(response.text)),
              key: data.key,
            });
          } else {
            noteContent = decodeURIComponent(response.text);
          }
          const newFile = this.app.vault.create(newFilename, noteContent).then((file) => {
            this.app.workspace.openLinkText(file.path, file.path, true);
          });
        } else {
          console.log("Error uploading file");
        }

        return;
      }
    });

    // Add command - Share note
    this.addCommand({
      id: "send-note",
      name: "Send current note",
      callback: () => this.uploadNote(),
    });

    // Add command - Share note and force a re-upload of all assets
    this.addCommand({
      id: "force-upload",
      name: "Force re-upload of all data for this note",
      callback: () => this.uploadNote(true),
    });

    // Add command - Delete shared note
    this.addCommand({
      id: "delete-note",
      name: "Delete this sent note",
      checkCallback: (checking: boolean) => {
        const sharedFile = this.hasSharedFile();
        if (checking) {
          return !!sharedFile;
        } else if (sharedFile) {
          this.deleteSharedNote(sharedFile.file);
        }
      },
    });

    // Add command - Copy shared link
    this.addCommand({
      id: "copy-link",
      name: "Copy sent note link",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (checking) {
          return file instanceof TFile;
        } else if (file) {
          this.copyShareLink(file);
        }
      },
    });

    // Add a 'Copy shared link' menu item to the 3-dot editor menu
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((item) => {
            item.setIcon("share-2");
            item.setTitle("Copy shared link");
            item.onClick(async () => {
              await this.copyShareLink(file);
            });
          });
        }
      })
    );

    // Add share icons to properties panel
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.addShareIcons();
      })
    );
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * Upload a note.
   * @param forceUpload - Optionally force an upload of all related assets
   * @param forceClipboard - Optionally copy the link to the clipboard, regardless of the user setting
   */
  async uploadNote(forceUpload = false, forceClipboard = false) {
    const file = this.app.workspace.getActiveFile();
    if (file instanceof TFile) {
      const meta = this.app.metadataCache.getFileCache(file);
      const note = new Note(this);
      const noteContent = await this.app.vault.read(file);

      if (this.settings.shareUnencrypted) {
        // The user has opted to share unencrypted by default
        note.shareAsPlainText(true);
      }
      if (meta?.frontmatter?.[note.field(YamlField.unencrypted)] === true) {
        // User has set the frontmatter property 'share_unencrypted` = true
        note.shareAsPlainText(true);
      }
      if (meta?.frontmatter?.[note.field(YamlField.encrypted)] === true) {
        // User has set the frontmatter property `share_encrypted` = true
        // This setting goes after the 'unencrypted' setting, just in case of conflicting checkboxes
        note.shareAsPlainText(false);
      }
      if (forceUpload) {
        note.forceUpload();
      }
      if (forceClipboard) {
        note.forceClipboard();
      }
      try {
        await note.share();
      } catch (e) {
        // Known errors are outputted by api.js
        if (e.message !== "Known error") {
          console.log(e);
          new StatusMessage("There was an error uploading the note, please try again.", StatusType.Error);
        }
      }
      note.status.hide(); // clean up status just in case
      this.addShareIcons();
    }
  }

  /**
   * Copy the share link to the clipboard. The note will be shared first if neccessary.
   * @param file
   */
  async copyShareLink(file: TFile): Promise<string | undefined> {
    const meta = this.app.metadataCache.getFileCache(file);
    const shareLink = meta?.frontmatter?.[this.settings.yamlField + "_" + YamlField[YamlField.link]];
    if (shareLink) {
      // The note is already shared, copy the link to the clipboard
      await navigator.clipboard.writeText(shareLink);
      new StatusMessage("📋 Shared link copied to clipboard");
    } else {
      // The note is not already shared, share it first and copy the link to the clipboard
      await this.uploadNote(false, true);
    }
    return shareLink;
  }

  async deleteSharedNote(file: TFile) {
    const sharedFile = this.hasSharedFile(file);
    if (sharedFile) {
      this.ui.confirmDialog(
        "Delete shared note?",
        "Are you sure you want to delete this shared note and the shared link? This will not delete your local note.",
        async () => {
          new StatusMessage("Deleting note...");
          // await this.api.deleteSharedNote(sharedFile.url);

          await this.deletePaste(this.getIdentifier(sharedFile.url));

          await this.app.fileManager.processFrontMatter(sharedFile.file, (frontmatter) => {
            // Remove the shared link
            delete frontmatter[this.field(YamlField.link)];
            delete frontmatter[this.field(YamlField.updated)];
          });
        }
      );
    }
  }

  addShareIcons() {
    // I tried using onLayoutReady() here rather than a timeout/interval, but it did not work.
    // It seems that the layout is still updating even after it is "ready".
    let count = 0;
    const timer = setInterval(() => {
      count++;
      if (count > 8) {
        clearInterval(timer);
        return;
      }
      const activeFile = this.app.workspace.getActiveFile();
      if (!activeFile) return;
      const shareLink = this.app.metadataCache.getFileCache(activeFile)?.frontmatter?.[this.field(YamlField.link)];
      if (!shareLink) return;
      document
        .querySelectorAll(`div.metadata-property[data-property-key="${this.field(YamlField.link)}"]`)
        .forEach((propertyEl) => {
          const valueEl = propertyEl.querySelector("div.metadata-property-value");
          const linkEl = valueEl?.querySelector("div.external-link") as HTMLElement;
          if (linkEl?.innerText !== shareLink) return;
          // Remove existing elements
          // valueEl?.querySelectorAll('div.share-note-icons').forEach(el => el.remove())
          if (valueEl && !valueEl.querySelector("div.send-note-icons")) {
            const iconsEl = document.createElement("div");
            iconsEl.classList.add("send-note-icons");
            // Re-share note icon
            const shareIcon = iconsEl.createEl("span");
            shareIcon.title = "Re-send note";
            setIcon(shareIcon, "upload-cloud");
            shareIcon.onclick = () => this.uploadNote();
            // Copy to clipboard icon
            const copyIcon = iconsEl.createEl("span");
            copyIcon.title = "Copy link to clipboard";
            setIcon(copyIcon, "copy");
            copyIcon.onclick = async () => {
              await navigator.clipboard.writeText(shareLink);
              new StatusMessage("📋 Sending link copied to clipboard");
            };
            // Delete shared note icon
            const deleteIcon = iconsEl.createEl("span");
            deleteIcon.title = "Delete sent note";
            setIcon(deleteIcon, "trash-2");
            deleteIcon.onclick = () => this.deleteSharedNote(activeFile);
            valueEl.prepend(iconsEl);
          }
        });
    }, 50);
  }

  hasSharedFile(file?: TFile) {
    if (!file) {
      file = this.app.workspace.getActiveFile() || undefined;
    }
    if (file) {
      const meta = this.app.metadataCache.getFileCache(file);
      const shareLink = meta?.frontmatter?.[this.settings.yamlField + "_" + YamlField[YamlField.link]];
      if (shareLink && parseExistingShareUrl(shareLink)) {
        return {
          file,
          ...parseExistingShareUrl(shareLink),
        } as SharedNote;
      }
    }
    return false;
  }

  field(key: YamlField) {
    return [this.settings.yamlField, YamlField[key]].join("_");
  }

  async deletePaste(pasteKey: string) {
    const url = "https://pastebin.com/api/api_post.php";

    const formData = new URLSearchParams();
    formData.append("api_dev_key", this.settings.pastebinApiKey);
    formData.append("api_user_key", this.settings.pastebinUserKey);
    formData.append("api_paste_key", pasteKey);
    formData.append("api_option", "delete");

    try {
      const response = await requestUrl({
        url: url,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      });

      const result = await response.text;

      if (result.trim() === "Paste Removed") {
      } else {
        console.error("Error deleting paste:", result);
      }
    } catch (error) {
      console.error("Network or parsing error:", error);
    }
  }

  private generateRandomString(length = 5) {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";

    for (let i = 0; i < length; i++) {
      // Pick a random index from the characters string
      const randomIndex = Math.floor(Math.random() * characters.length);

      // Append the character at the random index to the result string
      result += characters.charAt(randomIndex);
    }

    return result;
  }

  private getIdentifier(url: string) {
    try {
      // Create a URL object from the given URL string
      const urlObj = new URL(url);

      // Get the value of the 'sendurl' query parameter
      const sendUrlParam = urlObj.searchParams.get("sendurl");

      if (sendUrlParam) {
        // Create a new URL object from the 'sendurl' parameter
        const sendUrlObj = new URL(sendUrlParam);

        // Extract the pathname from the URL
        const pathname = sendUrlObj.pathname;

        // Extract and return the identifier from the pathname
        // Assuming the identifier is the part after the last '/' in the pathname
        const identifier = pathname.substring(pathname.lastIndexOf("/") + 1);

        return identifier;
      } else {
        throw new Error("sendurl parameter not found");
      }
    } catch (error) {
      console.error("Invalid URL:", error);
      return "";
    }
  }
}
