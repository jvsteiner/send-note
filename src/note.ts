import { CachedMetadata, moment, requestUrl, TFile, View, WorkspaceLeaf } from "obsidian";
import { encryptString, sha1 } from "./crypto";
import SharePlugin from "./main";
import StatusMessage, { StatusType } from "./StatusMessage";
import NoteTemplate, { ElementStyle, getElementStyle } from "./NoteTemplate";
import { ThemeMode, TitleSource, YamlField } from "./settings";
import { dataUriToBuffer } from "data-uri-to-buffer";
import FileTypes from "./libraries/FileTypes";
import { CheckFilesResult, parseExistingShareUrl } from "./api";
import { minify } from "csso";
import DurationConstructor = moment.unitOfTime.DurationConstructor;

const cssAttachmentWhitelist: { [key: string]: string[] } = {
  ttf: ["font/ttf", "application/x-font-ttf", "application/x-font-truetype", "font/truetype"],
  otf: ["font/otf", "application/x-font-opentype"],
  woff: ["font/woff", "application/font-woff", "application/x-font-woff"],
  woff2: ["font/woff2", "application/font-woff2", "application/x-font-woff2"],
  svg: ["image/svg+xml"],
};

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
  template: NoteTemplate;
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
    this.template = new NoteTemplate();
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

  async share() {
    // Create a semi-permanent status notice which we can update
    this.status = new StatusMessage(
      "If this message is showing, please do not change to another note as the current note data is still being parsed.",
      StatusType.Default,
      60 * 1000
    );

    if (this.plugin.settings.usePastebin) {
      let pastebinApiKey = this.plugin.settings.pastebinApiKey;
      let pastebinUserKey = this.plugin.settings.pastebinUserKey;
      let shareUnencrypted = this.plugin.settings.shareUnencrypted;
      let expiry = this.plugin.settings.pastebinExpiry;
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
        api_dev_key: pastebinApiKey,
        api_user_key: pastebinUserKey,
        api_option: "paste",
        api_paste_private: 1,
        api_paste_name: this.file.basename,
        api_paste_expire_date: expiry,
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
      // send the note to pastebin

      return;
    }

    const startMode = this.leaf.getViewState();
    const previewMode = this.leaf.getViewState();
    previewMode.state.mode = "preview";
    await this.leaf.setViewState(previewMode);
    await new Promise((resolve) => setTimeout(resolve, 40));
    // Scroll the view to the top to ensure we get the default margins for .markdown-preview-pusher
    // @ts-ignore
    this.leaf.view.previewMode.applyScroll(0); // 'view.previewMode'
    await new Promise((resolve) => setTimeout(resolve, 40));
    try {
      const view = this.leaf.view as ViewModes;
      const renderer = view.modes.preview.renderer;
      // Copy classes and styles
      this.elements.push(getElementStyle("html", document.documentElement));
      const bodyStyle = getElementStyle("body", document.body);
      bodyStyle.classes.push("share-note-plugin"); // Add a targetable class for published notes
      this.elements.push(bodyStyle);
      this.elements.push(getElementStyle("preview", renderer.previewEl));
      this.elements.push(getElementStyle("pusher", renderer.pusherEl));
      this.contentDom = new DOMParser().parseFromString(
        await this.querySelectorAll(this.leaf.view as ViewModes),
        "text/html"
      );
      this.cssRules = [];
      Array.from(document.styleSheets).forEach((x) =>
        Array.from(x.cssRules).forEach((rule) => {
          this.cssRules.push(rule);
        })
      );
      this.css = this.cssRules
        .map((rule) => rule.cssText)
        .join("")
        .replace(/\n/g, "");
    } catch (e) {
      console.log(e);
      this.status.hide();
      new StatusMessage("Failed to parse current note, check console for details", StatusType.Error);
      return;
    }

    // Reset the view to the original mode
    // The timeout is required, even though we 'await' the preview mode setting earlier
    setTimeout(() => {
      this.leaf.setViewState(startMode);
    }, 200);

    this.status.setStatus("Processing note...");
    const file = this.plugin.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) {
      // No active file
      this.status.hide();
      new StatusMessage("There is no active file to share");
      return;
    }
    this.meta = this.plugin.app.metadataCache.getFileCache(file);

    // Generate the HTML file for uploading

    if (this.plugin.settings.removeYaml) {
      // Remove frontmatter to avoid sharing unwanted data
      this.contentDom.querySelector("div.metadata-container")?.remove();
      this.contentDom.querySelector("pre.frontmatter")?.remove();
      this.contentDom.querySelector("div.frontmatter-container")?.remove();
    } else {
      // Frontmatter properties are weird - the DOM elements don't appear to contain any data.
      // We get the property name from the data-property-key and set that on the labelEl value,
      // then take the corresponding value from the metadataCache and set that on the valueEl value.
      this.contentDom.querySelectorAll("div.metadata-property").forEach((propertyContainerEl) => {
        const propertyName = propertyContainerEl.getAttribute("data-property-key");
        if (propertyName) {
          const labelEl = propertyContainerEl.querySelector("input.metadata-property-key-input");
          labelEl?.setAttribute("value", propertyName);
          const valueEl = propertyContainerEl.querySelector("div.metadata-property-value > input");
          const value = this.meta?.frontmatter?.[propertyName] || "";
          valueEl?.setAttribute("value", value);
          // Special cases for different element types
          switch (valueEl?.getAttribute("type")) {
            case "checkbox":
              if (value) valueEl.setAttribute("checked", "checked");
              break;
          }
        }
      });
    }
    if (this.plugin.settings.removeBacklinksFooter) {
      // Remove backlinks footer
      this.contentDom.querySelector("div.embedded-backlinks")?.remove();
    }

    // Fix callout icons
    const defaultCalloutType = this.getCalloutIcon((selectorText) => selectorText === ".callout") || "pencil";
    for (const el of this.contentDom.getElementsByClassName("callout")) {
      // Get the callout icon from the CSS. I couldn't find any way to do this from the DOM,
      // as the elements may be far down below the fold and are not populated.
      const type = el.getAttribute("data-callout");
      let icon =
        this.getCalloutIcon((selectorText) => selectorText.includes(`data-callout="${type}"`)) || defaultCalloutType;
      icon = icon.replace("lucide-", "");
      // Replace the existing icon so we:
      // a) don't get double-ups, and
      // b) have a consistent style
      const iconEl = el.querySelector("div.callout-icon");
      const svgEl = iconEl?.querySelector("svg");
      if (svgEl) {
        svgEl.outerHTML = `<svg width="16" height="16" data-share-note-lucide="${icon}"></svg>`;
      }
    }

    // Replace links
    for (const el of this.contentDom.querySelectorAll<HTMLElement>("a.internal-link, a.footnote-link")) {
      const href = el.getAttribute("href");
      const match = href ? href.match(/^([^#]+)/) : null;
      if (href?.match(/^#/)) {
        // This is an Anchor link to a document heading, we need to add custom Javascript
        // to jump to that heading rather than using the normal # link
        const linkTypes = [
          `[data-heading="${href.slice(1)}"]`, // Links to a heading
          `[id="${href.slice(1)}"]`, // Links to a footnote
        ];
        linkTypes.forEach((selector) => {
          if (this.contentDom.querySelectorAll(selector)?.[0]) {
            el.setAttribute("onclick", `document.querySelectorAll('${selector}')[0].scrollIntoView(true)`);
          }
        });
        el.removeAttribute("target");
        el.removeAttribute("href");
        continue;
      } else if (match) {
        // This is a link to another note - check to see if we can link to an already shared note
        const linkedFile = this.plugin.app.metadataCache.getFirstLinkpathDest(match[1], "");
        if (linkedFile instanceof TFile) {
          const linkedMeta = this.plugin.app.metadataCache.getFileCache(linkedFile);
          if (linkedMeta?.frontmatter?.[this.field(YamlField.link)]) {
            // This file is shared, so update the link with the share URL
            el.setAttribute("href", linkedMeta?.frontmatter?.[this.field(YamlField.link)]);
            el.removeAttribute("target");
            continue;
          }
        }
      }
      // This linked note is not shared, so remove the link and replace with the non-link content
      el.replaceWith(el.innerText);
    }
    for (const el of this.contentDom.querySelectorAll<HTMLElement>("a.external-link")) {
      // Remove target=_blank from external links
      el.removeAttribute("target");
    }

    // Note options
    this.expiration = this.getExpiration();

    /*
     * Encrypt the note contents
     */

    // Use previous name and key if they exist, so that links will stay consistent across updates
    let decryptionKey = "";
    if (this.meta?.frontmatter?.[this.field(YamlField.link)]) {
      const match = parseExistingShareUrl(this.meta?.frontmatter?.[this.field(YamlField.link)]);
      if (match) {
        this.template.filename = match.filename;
        decryptionKey = match.decryptionKey;
      }
    }
    this.template.encrypted = this.isEncrypted;

    // Select which source for the title
    let title;
    switch (this.plugin.settings.titleSource) {
      case TitleSource["First H1"]:
        title = this.contentDom.getElementsByTagName("h1")?.[0]?.innerText;
        break;
      case TitleSource["Frontmatter property"]:
        title = this.meta?.frontmatter?.[this.field(YamlField.title)];
        break;
    }
    if (!title) {
      // Fallback to basename if either of the above fail
      title = file.basename;
    }

    if (this.isEncrypted) {
      this.status.setStatus("Encrypting note...");
      const plaintext = JSON.stringify({
        content: this.contentDom.body.innerHTML,
        basename: title,
      });
      // Encrypt the note
      const encryptedData = await encryptString(plaintext, decryptionKey);
      this.template.content = JSON.stringify({
        ciphertext: encryptedData.ciphertext,
      });
      decryptionKey = encryptedData.key;
    } else {
      // This is for notes shared without encryption, using the
      // share_unencrypted frontmatter property
      this.template.content = this.contentDom.body.innerHTML;
      this.template.title = title;
      // Create a meta description preview based off the <p> elements
      const desc = Array.from(this.contentDom.querySelectorAll("p"))
        .map((x) => x.innerText)
        .filter((x) => !!x)
        .join(" ");
      this.template.description = desc.length > 200 ? desc.slice(0, 197) + "..." : desc;
    }

    // Make template value replacements
    this.template.width = this.plugin.settings.noteWidth;
    // Set theme light/dark
    if (this.plugin.settings.themeMode !== ThemeMode["Same as theme"]) {
      this.elements
        .filter((x) => x.element === "body")
        .forEach((item) => {
          // Remove the existing theme setting
          item.classes = item.classes.filter((cls) => cls !== "theme-dark" && cls !== "theme-light");
          // Add the preferred theme setting (dark/light)
          item.classes.push("theme-" + ThemeMode[this.plugin.settings.themeMode].toLowerCase());
        });
    }
    this.template.elements = this.elements;
    // Check for MathJax
    this.template.mathJax = !!this.contentDom.body.innerHTML.match(/<mjx-container/);

    // Share the file
    this.status.setStatus("Uploading note...");
    let shareLink = await this.plugin.api.createNote(this.template, this.expiration);
    requestUrl(shareLink).then().catch(); // Fetch the uploaded file to pull it through the cache

    // Add the decryption key to the share link
    if (shareLink && this.isEncrypted) {
      shareLink += "#" + decryptionKey;
    }

    let shareMessage = "The note has been shared";
    if (shareLink) {
      await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
        // Update the frontmatter with the share link
        frontmatter[this.field(YamlField.link)] = shareLink;
        frontmatter[this.field(YamlField.updated)] = moment().format();
      });
      if (this.plugin.settings.clipboard || this.isForceClipboard) {
        // Copy the share link to the clipboard
        try {
          await navigator.clipboard.writeText(shareLink);
          shareMessage = `${shareMessage} and the link is copied to your clipboard 📋`;
        } catch (e) {
          // If there's an error here it's because the user clicked away from the Obsidian window
        }
        this.isForceClipboard = false;
      }
    }

    this.status.hide();
    new StatusMessage(shareMessage, StatusType.Success);
  }

  async querySelectorAll(view: ViewModes) {
    const renderer = view.modes.preview.renderer;
    let html = "";
    await new Promise<void>((resolve) => {
      let count = 0;
      let parsing = 0;
      const timer = setInterval(() => {
        try {
          const sections = renderer.sections;
          count++;
          if (renderer.parsing) parsing++;
          if (count > parsing) {
            // Check the final sections to see if they have rendered
            let rendered = 0;
            if (sections.length > 12) {
              sections.slice(sections.length - 7, sections.length - 1).forEach((section: PreviewSection) => {
                if (section.el.innerHTML) rendered++;
              });
              if (rendered > 3) count = 100;
            } else {
              count = 100;
            }
          }
          if (count > 40) {
            html = this.reduceSections(renderer.sections);
            resolve();
          }
        } catch (e) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
    return html;
  }

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

  reduceSections(sections: { el: HTMLElement }[]) {
    return sections.reduce((p: string, c) => p + c.el.outerHTML, "");
  }

  /**
   * Turn the font mime-type into an extension.
   * @param {string} mimeType
   * @return {string|undefined}
   */
  extensionFromMime(mimeType: string): string | undefined {
    const mimes = cssAttachmentWhitelist;
    return Object.keys(mimes).find((x) => mimes[x].includes((mimeType || "").toLowerCase()));
  }

  /**
   * Get the value of a frontmatter property
   */
  getProperty(field: YamlField) {
    return this.meta?.frontmatter?.[this.plugin.field(field)];
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
   * Enable/disable encryption for the note
   */
  shareAsPlainText(isPlainText: boolean) {
    this.isEncrypted = !isPlainText;
  }

  /**
   * Calculate an expiry datetime from the provided expiry duration
   */
  getExpiration() {
    const whitelist = ["minute", "hour", "day", "month"];
    const expiration = this.getProperty(YamlField.expires) || this.plugin.settings.expiry;
    if (expiration) {
      // Check for sanity against expected format
      const match = expiration.match(/^(\d+) ([a-z]+?)s?$/);
      if (match && whitelist.includes(match[2])) {
        return parseInt(
          moment()
            .add(+match[1], (match[2] + "s") as DurationConstructor)
            .format("x"),
          10
        );
      }
    }
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
