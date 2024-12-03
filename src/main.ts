import { Plugin, requestUrl, setIcon, TFile, RequestUrlParam } from "obsidian";
import { DEFAULT_SETTINGS, SendNoteSettings, SendNoteSettingsTab, YamlField } from "./settings";
import Note, { SharedNote } from "./note";
import API, { parseExistingShareUrl } from "./api";
import StatusMessage, { StatusType } from "./StatusMessage";
import { shortHash, sha256, decryptString } from "./crypto";
import UI from "./UI";
import { S3Client, PutObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { HttpHandlerOptions } from "@aws-sdk/types";
import { buildQueryString } from "@aws-sdk/querystring-builder";
import { requestTimeout } from "@smithy/fetch-http-handler/dist-es/request-timeout";
import { FetchHttpHandler, FetchHttpHandlerOptions } from "@smithy/fetch-http-handler";
import { HttpRequest, HttpResponse } from "@aws-sdk/protocol-http";
import * as crypto from "crypto";

export default class SendNotePlugin extends Plugin {
  settings: SendNoteSettings;
  api: API;
  settingsPage: SendNoteSettingsTab;
  ui: UI;
  s3: S3Client;
  private iconUpdateTimer: NodeJS.Timeout;

  // Expose some tools in the plugin object
  hash = shortHash;
  sha256 = sha256;

  async onload() {
    // Settings page
    await this.loadSettings();

    this.settingsPage = new SendNoteSettingsTab(this.app, this);
    this.addSettingTab(this.settingsPage);

    let apiEndpoint = this.settings.useCustomEndpoint
      ? this.settings.customEndpoint
      : `https://s3.${this.settings.region}.amazonaws.com/`;
    this.settings.imageUrlPath = this.settings.useCustomImageUrl
      ? this.settings.customImageUrl
      : this.settings.forcePathStyle
      ? apiEndpoint + this.settings.bucket + "/"
      : apiEndpoint.replace("://", `://${this.settings.bucket}.`);

    // Initialise the backend API
    this.ui = new UI(this.app);
    this.s3 = new S3Client({
      region: this.settings.region,
      credentials: {
        // clientConfig: { region: this.settings.region },
        accessKeyId: this.settings.accessKey,
        secretAccessKey: this.settings.secretKey,
      },
      endpoint: apiEndpoint,
      // forcePathStyle: this.settings.forcePathStyle,
      requestHandler: new ObsHttpHandler({ keepAlive: false }),
    });

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

  async uploadFile(content: string, key: string): Promise<string> {
    // const buf = await file.arrayBuffer();

    let folder = this.settings.folder;

    console.log("Uploading file:", key);
    console.log("Uploading to folder:", folder);

    const currentDate = new Date();
    folder = folder
      .replace("${year}", currentDate.getFullYear().toString())
      .replace("${month}", String(currentDate.getMonth() + 1).padStart(2, "0"))
      .replace("${day}", String(currentDate.getDate()).padStart(2, "0"));

    const keyHash = md5Hash(key);

    key = folder ? `${folder}/${keyHash}` : keyHash;

    const encoder = new TextEncoder();
    const utf8Array = encoder.encode(content);

    await this.s3
      .send(
        new PutObjectCommand({
          Bucket: this.settings.bucket,
          Key: key,
          Body: utf8Array,
          ContentType: "text/plain",
        })
      )
      .catch((err) => {
        console.error("Error uploading file:", err);
      });
    let urlString = this.settings.imageUrlPath + key;
    if (this.settings.queryStringKey && this.settings.queryStringValue) {
      let urlObject = new URL(urlString);

      // The searchParams property provides methods to manipulate query parameters
      urlObject.searchParams.append(this.settings.queryStringKey, this.settings.queryStringValue);
      urlString = urlObject.toString();
    }
    return urlString;
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
      new StatusMessage("📋 Shared link copied to clipboard", StatusType.Default, 2000);
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
          new StatusMessage("Deleting note...", StatusType.Default, 2000);
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

  async addShareIcons() {
    if (this.iconUpdateTimer) {
      clearInterval(this.iconUpdateTimer);
    }

    // Get the active file
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      console.debug("No active file found");
      return;
    }

    // Wait for metadata cache to be ready
    let count = 0;
    this.iconUpdateTimer = setInterval(async () => {
      count++;
      if (count > 40) {
        // Increased max attempts significantly
        console.debug("Exceeded max attempts to add share icons");
        clearInterval(this.iconUpdateTimer);
        return;
      }

      // Wait for metadata cache to resolve
      const fileCache = this.app.metadataCache.getFileCache(activeFile);
      if (!fileCache || !fileCache.frontmatter) {
        console.debug("Waiting for metadata cache...");
        return;
      }

      // Once we have the metadata, clear the interval
      clearInterval(this.iconUpdateTimer);

      // Get the share link field name
      const shareLinkField = this.field(YamlField.link);
      console.debug("Looking for share link field:", shareLinkField);

      // Get the share link
      const shareLink = fileCache.frontmatter[shareLinkField];
      console.debug("Share link found:", shareLink);

      if (!shareLink) {
        console.debug("No share link found in frontmatter");
        return;
      }

      // Create icons after a short delay to ensure DOM is ready
      setTimeout(() => {
        const propertyElements = document.querySelectorAll(`[data-property-key="${shareLinkField}"]`);
        console.debug("Found property elements:", propertyElements.length);

        propertyElements.forEach((propertyEl) => {
          let valueEl = null;
          for (const selector of [
            ".metadata-property-value",
            ".property-value",
            '[class*="metadata-property-value"]',
            '[class*="property-value"]',
          ]) {
            valueEl = propertyEl.querySelector(selector);
            if (valueEl) {
              console.debug("Found value element with selector:", selector);
              break;
            }
          }

          if (!valueEl) {
            console.debug("Value element not found");
            return;
          }

          // Check if icons already exist
          if (valueEl.querySelector(".send-note-icons")) {
            console.debug("Icons already exist");
            return;
          }

          // Find the link element
          let linkEl = null;
          for (const selector of [".external-link", "a.external-link", '[class*="external-link"]']) {
            linkEl = valueEl.querySelector(selector);
            if (linkEl) {
              console.debug("Found link element with selector:", selector);
              break;
            }
          }

          if (!linkEl || linkEl.textContent !== shareLink) {
            console.debug("Link element not found or mismatch", {
              linkEl: linkEl?.textContent,
              shareLink,
            });
            return;
          }

          // Create icons container
          const iconsEl = document.createElement("div");
          iconsEl.className = "send-note-icons";
          iconsEl.style.display = "inline-flex";
          iconsEl.style.gap = "8px";
          iconsEl.style.marginRight = "8px";
          iconsEl.style.alignItems = "center";

          // Re-share note icon
          const shareIcon = iconsEl.createEl("span");
          shareIcon.title = "Re-send note";
          setIcon(shareIcon, "upload-cloud");
          shareIcon.style.cursor = "pointer";
          shareIcon.onclick = () => this.uploadNote();

          // Copy to clipboard icon
          const copyIcon = iconsEl.createEl("span");
          copyIcon.title = "Copy link to clipboard";
          setIcon(copyIcon, "copy");
          copyIcon.style.cursor = "pointer";
          copyIcon.onclick = async () => {
            await navigator.clipboard.writeText(shareLink);
            new StatusMessage(" Sending link copied to clipboard", StatusType.Default, 2000);
          };

          // Delete shared note icon
          const deleteIcon = iconsEl.createEl("span");
          deleteIcon.title = "Delete sent note";
          setIcon(deleteIcon, "trash-2");
          deleteIcon.style.cursor = "pointer";
          deleteIcon.onclick = () => this.deleteSharedNote(activeFile);

          // Insert icons at the start of the value element
          valueEl.insertBefore(iconsEl, valueEl.firstChild);
        });
      }, 100); // Short delay after metadata is ready
    }, 100); // Check metadata every 100ms
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

  field(key: YamlField): string {
    const fieldName = [this.settings.yamlField, YamlField[key]].join("_");
    console.debug("Generated field name:", fieldName);
    return fieldName;
  }

  async deletePaste(pasteKey: string) {
    this.s3
      .send(
        new DeleteObjectsCommand({
          Bucket: this.settings.bucket,
          Delete: {
            Objects: [
              {
                Key: pasteKey,
              },
            ],
          },
        })
      )
      .then((data) => {
        new StatusMessage(`Deleted note: ${data.Deleted?.[0]?.Key}`, StatusType.Default, 2000);
      })
      .catch((err) => {
        console.log("error", err);
      });
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
        // const pathname = sendUrlObj.pathname;

        // Extract and return the identifier from the pathname
        // Assuming the identifier is the part after the last '/' in the pathname
        // const identifier = pathname.substring(pathname.lastIndexOf("/") + 1);

        return sendUrlObj.pathname.slice(1);
      } else {
        throw new Error("sendurl parameter not found");
      }
    } catch (error) {
      console.error("Invalid URL:", error);
      return "";
    }
  }
}

/**
 * This is close to origin implementation of FetchHttpHandler
 * https://github.com/aws/aws-sdk-js-v3/blob/main/packages/fetch-http-handler/src/fetch-http-handler.ts
 * that is released under Apache 2 License.
 * But this uses Obsidian requestUrl instead.
 */
class ObsHttpHandler extends FetchHttpHandler {
  requestTimeoutInMs: number | undefined;
  constructor(options?: FetchHttpHandlerOptions) {
    super(options);
    this.requestTimeoutInMs = options === undefined ? undefined : options.requestTimeout;
  }
  async handle(request: HttpRequest, { abortSignal }: HttpHandlerOptions = {}): Promise<{ response: HttpResponse }> {
    if (abortSignal?.aborted) {
      const abortError = new Error("Request aborted");
      abortError.name = "AbortError";
      return Promise.reject(abortError);
    }

    let path = request.path;
    if (request.query) {
      const queryString = buildQueryString(request.query);
      if (queryString) {
        path += `?${queryString}`;
      }
    }

    const { port, method } = request;
    const url = `${request.protocol}//${request.hostname}${port ? `:${port}` : ""}${path}`;
    const body = method === "GET" || method === "HEAD" ? undefined : request.body;

    const transformedHeaders: Record<string, string> = {};
    for (const key of Object.keys(request.headers)) {
      const keyLower = key.toLowerCase();
      if (keyLower === "host" || keyLower === "content-length") {
        continue;
      }
      transformedHeaders[keyLower] = request.headers[key];
    }

    let contentType: string | undefined = undefined;
    if (transformedHeaders["content-type"] !== undefined) {
      contentType = transformedHeaders["content-type"];
    }

    let transformedBody: any = body;
    if (ArrayBuffer.isView(body)) {
      transformedBody = bufferToArrayBuffer(body);
    }

    const param: RequestUrlParam = {
      body: transformedBody,
      headers: transformedHeaders,
      method: method,
      url: url,
      contentType: contentType,
    };

    const raceOfPromises = [
      requestUrl(param).then((rsp) => {
        const headers = rsp.headers;
        const headersLower: Record<string, string> = {};
        for (const key of Object.keys(headers)) {
          headersLower[key.toLowerCase()] = headers[key];
        }
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(rsp.arrayBuffer));
            controller.close();
          },
        });
        return {
          response: new HttpResponse({
            headers: headersLower,
            statusCode: rsp.status,
            body: stream,
          }),
        };
      }),
      requestTimeout(this.requestTimeoutInMs),
    ];

    if (abortSignal) {
      raceOfPromises.push(
        new Promise<never>((resolve, reject) => {
          abortSignal.onabort = () => {
            const abortError = new Error("Request aborted");
            abortError.name = "AbortError";
            reject(abortError);
          };
        })
      );
    }
    return Promise.race(raceOfPromises);
  }
}

const bufferToArrayBuffer = (b: Buffer | Uint8Array | ArrayBufferView) => {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

function md5Hash(text: string): string {
  return crypto.createHash("md5").update(text, "utf8").digest("hex");
}
